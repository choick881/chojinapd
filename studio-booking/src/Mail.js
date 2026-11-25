/**
 * 자동 메일 — 부서 공동계정(스크립트 소유 계정)에서 발송됩니다.
 * 문구를 바꾸려면 이 파일의 본문만 수정하면 됩니다.
 */
var Mail = (function () {
  function appUrl(page) {
    var url = webAppUrl();
    return url ? url + (page ? '?p=' + page : '') : '';
  }

  function line(b, studio) {
    return koDate(b.date) + ' ' + Rules.fmtMin(b.startMin) + '~' + Rules.fmtMin(b.endMin) + ' · ' + studio.location;
  }

  function details(b, studio) {
    return [
      '- 예약번호: ' + b.id,
      '- 일시: ' + koDate(b.date) + ' ' + Rules.fmtMin(b.startMin) + '~' + Rules.fmtMin(b.endMin),
      '- 스튜디오: ' + studio.code + ' ' + studio.location + ' (' + studio.org + ', 내선 ' + studio.ext + ')',
      '- 촬영 유형: ' + b.shootType + ' / 용도: ' + b.purpose,
      '- 촬영 지원: ' + (b.support ? '필요' : '불필요'),
      b.onBehalf ? '- 대리 예약: ' + b.name + '님이 ' + b.onBehalf + ' 교수님 대신 예약 (교수님께 참조로 함께 보냅니다)' : '',
    ].filter(String).join('\n');
  }

  function checkinGuide(cfg) {
    return [
      '[QR 체크인 안내]',
      '스튜디오 출입문 옆 QR 코드를 휴대폰 카메라로 찍고, 학교 구글 계정으로 로그인한 뒤 "체크인" 버튼을 눌러 주세요.',
      '시작 ' + cfg.checkinEarlyMin + '분 전부터 체크인할 수 있으며, 시작 후 ' + cfg.noShowGraceMin + '분(짧은 예약은 종료 시각) 안에 체크인하지 않으면 노쇼로 처리됩니다.',
      '학기 중 노쇼 ' + cfg.sanctionThreshold + '회부터 ' + cfg.sanctionDays + '일 동안 예약이 제한됩니다.',
    ].join('\n');
  }

  function footer(cfg) {
    return [
      '',
      '- 내 예약 확인·취소: ' + appUrl('my'),
      '- 취소·변경은 이용 전날 ' + Rules.fmtMin(cfg.deadlineMin) + '까지 직접 할 수 있습니다. 이후에는 담당자에게 연락해 주세요.',
      '- 문의: ' + cfg.contact,
      '',
      '본 메일은 발신 전용입니다.',
    ].join('\n');
  }

  function send(to, subject, body, cfg, cc) {
    var opts = { name: cfg.senderName || 'HY FLIP' };
    if (cc) opts.cc = cc;
    MailApp.sendEmail(to, '[HY FLIP] ' + subject, body, opts);
  }

  /** 예약 관련 메일: 대리 예약이면 대상 교수에게 참조 */
  function sendB(b, subject, body, cfg) {
    send(b.email, subject, body, cfg, b.onBehalf || '');
  }

  return {
    confirmed: function (b, studio, cfg, note) {
      sendB(b, '셀프스튜디오 예약이 확정되었습니다 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n셀프스튜디오 예약이 확정되었습니다.' +
        (note ? '\n' + note : '') + '\n\n' + details(b, studio) + '\n\n' + checkinGuide(cfg) + '\n' + footer(cfg), cfg);
    },

    pending: function (b, studio, cfg) {
      sendB(b, '셀프스튜디오 촬영 지원 요청이 접수되었습니다 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n촬영 지원이 필요한 예약으로 접수되어, 해당 시간은 임시로 확보해 두었습니다.' +
        '\n담당자가 일정을 확인한 뒤 확정 또는 변경 결과를 메일로 안내드리겠습니다.\n\n' + details(b, studio) + '\n' + footer(cfg), cfg);
    },

    staffSupportRequest: function (b, studio, cfg) {
      if (!cfg.staffEmail) return;
      send(cfg.staffEmail, '촬영 지원 요청: ' + b.name + ' · ' + line(b, studio),
        '새 촬영 지원 요청이 들어왔습니다. 담당자 화면에서 확정·변경·반려해 주세요.\n\n' + details(b, studio) +
        '\n- 이용자: ' + b.name + ' (' + (b.userType ? b.userType + ', ' : '') + b.org + ', ' + b.email + ')\n\n담당자 화면: ' + appUrl('admin'), cfg);
    },

    adminResult: function (b, studio, cfg, changed) {
      sendB(b, '셀프스튜디오 촬영 지원 예약이 확정되었습니다 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n요청하신 촬영 지원 예약이 확정되었습니다.' +
        (changed ? '\n담당자와 조율한 내용에 따라 일정이 아래와 같이 변경되었습니다.' : '') +
        '\n\n' + details(b, studio) + '\n\n' + checkinGuide(cfg) + '\n' + footer(cfg), cfg);
    },

    adminModified: function (b, studio, cfg, memo) {
      sendB(b, '셀프스튜디오 예약이 변경되었습니다 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n담당자가 예약 내용을 아래와 같이 변경했습니다.' +
        (memo ? '\n사유: ' + memo : '') + '\n\n' + details(b, studio) + '\n' + footer(cfg), cfg);
    },

    rejected: function (b, studio, cfg, reason) {
      sendB(b, '셀프스튜디오 촬영 지원 요청 결과 안내',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n요청하신 촬영 지원 예약을 이번에는 확정하지 못했습니다.' +
        '\n사유: ' + (reason || '-') + '\n\n' + details(b, studio) +
        '\n\n다른 시간으로 다시 예약하시거나, 촬영 지원 없이 예약하실 수 있습니다.\n' + footer(cfg), cfg);
    },

    cancelled: function (b, studio, cfg, why) {
      sendB(b, '셀프스튜디오 예약이 취소되었습니다 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n아래 예약이 취소되었습니다. ' + (why || '') +
        '\n\n' + details(b, studio) + '\n' + footer(cfg), cfg);
    },

    noShow: function (b, studio, cfg, count, sanction) {
      var body = b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n아래 예약에 체크인 기록이 없어 노쇼로 처리되었습니다.' +
        ' (이번 학기 노쇼 ' + count + '회)\n\n' + details(b, studio) + '\n\n';
      if (sanction) {
        body += '학기 중 노쇼가 ' + cfg.sanctionThreshold + '회 이상이 되어 ' + sanction.until + '까지 셀프스튜디오 예약이 제한됩니다.\n' +
          '이미 잡아 두신 예약은 그대로 유지됩니다.\n';
      } else {
        body += '학기 중 노쇼가 ' + cfg.sanctionThreshold + '회가 되면 ' + cfg.sanctionDays + '일 동안 예약이 제한됩니다.\n';
      }
      body += '사전에 연락하셨거나 사정이 있었다면 담당자에게 알려 주세요. 확인 후 노쇼를 해제해 드립니다.\n' + footer(cfg);
      sendB(b, '셀프스튜디오 노쇼 처리 안내' + (sanction ? ' · 예약 제한' : ''), body, cfg);
    },

    sanctionLifted: function (email, cfg) {
      send(email, '셀프스튜디오 예약 제한이 해제되었습니다',
        '안녕하십니까. 에듀테크혁신팀입니다.\n\n셀프스튜디오 예약 제한이 해제되어 지금부터 다시 예약하실 수 있습니다.\n' +
        '- 예약하기: ' + appUrl('') + '\n' + footer(cfg), cfg);
    },

    reminder: function (b, studio, cfg) {
      sendB(b, '내일 셀프스튜디오 예약 안내 (' + line(b, studio) + ')',
        b.name + '님, 안녕하십니까. 에듀테크혁신팀입니다.\n\n내일 셀프스튜디오 예약이 있습니다.' +
        (b.status === Rules.STATUS.PENDING ? '\n(촬영 지원 요청은 아직 담당자 확인 중입니다.)' : '') +
        '\n이용하지 않으시면 오늘 ' + Rules.fmtMin(cfg.deadlineMin) + ' 전까지 꼭 취소해 주세요. 이후 취소나 미이용은 노쇼로 처리됩니다.\n\n' +
        details(b, studio) + '\n\n' + checkinGuide(cfg) + '\n' + footer(cfg), cfg);
    },
  };
})();
