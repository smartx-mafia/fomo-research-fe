/**
 * 六位码 → 中文人话 + 建议动作。
 *
 * **这张表必然落后于后端**，所以调用方必须有 unknown 分支原样显示 ——
 * 后端仓里 user.proto 的注释写 100100、docs/contracts/user.md 的表写 100107，
 * 两处已经不一致过一次。吞掉未知码的代价是：真正的线索被换成一句
 * "未知错误"，而排障时那正是唯一有用的东西。
 */
export type CodeInfo = {
  /** 一句话中文解释。 */
  text: string;
  /** 给测试者的下一步动作。 */
  advice: string;
  /** 是否允许自动重试。封禁/注销/账号冲突一律 false —— 自动重试会掩盖真问题。 */
  retryable: boolean;
};

export const CODES: Record<number, CodeInfo> = {
  100107: {
    text: '登录方式不支持，或与 Privy 上真实的绑定不一致',
    advice: '对照下面的 linked accounts：声称的 auth_method 必须真的在里面。',
    retryable: false,
  },
  100108: {
    text: '请求参数非法（identity_token 缺失或超长，上限 8192 字节）',
    advice: '多半是 identity token 取到了 null 就发了出去。',
    retryable: false,
  },
  400100: {
    text: 'identity token 无效或已过期',
    advice: '重取 identity token 后重试；反复失败说明 Privy 会话本身已失效，需重新登录。',
    retryable: true,
  },
  400101: {text: '账号已被封禁', advice: '联系客服。不要重试。', retryable: false},
  400102: {text: '账号已注销', advice: '不要重试。', retryable: false},
  200102: {
    text: '用户不存在（JWT 合法但用户行不在，数据异常）',
    advice: '附 trace_id 报障。',
    retryable: false,
  },
  420102: {
    text: '同一请求正在处理中（后端防重入，锁 TTL 10 秒）',
    advice: '等上一发返回，不要并发重放。',
    retryable: true,
  },
  430104: {
    text: 'Privy 账号数据冲突',
    advice: '服务端已告警，联系后端。**不要**自动重试。',
    retryable: false,
  },
  400000: {
    text: '未认证：本站 token 缺失、损坏或已失效',
    advice: '重新换取本站 token。若刚切换过后端，旧 token 必然失效。',
    retryable: false,
  },
  420000: {
    text: '触发限流（IP 层 20 rps / burst 40）',
    advice: '退避几秒再试。',
    retryable: true,
  },
  430113: {
    text: '邀请码名额已满',
    advice: '换一个邀请码；该码只在绑定邀请码流程中出现，不要原样重试。',
    retryable: false,
  },
  430114: {
    text: '账号已登录，但尚未完成邀请准入',
    advice: '跳转邀请准入流程（开放期调 POST /v1/invite/bind）；不要重试，也不要当成登录失效。',
    retryable: false,
  },
  500097: {
    text: '上游不可用：这个环境没配 Privy / X，或数据库连不上',
    advice: '看回包 metadata.upstream 区分是哪一路（x / database）。换一个后端，或联系运维。',
    retryable: false,
  },

  // ── Social（Opinion / Square / Follow）────────────────────────────
  100100: {text: '观点正文为空或超过长度限制', advice: '修改正文后再提交。', retryable: false},
  100101: {text: '观点附件格式无效', advice: '只保留有效的 X/Twitter 链接。', retryable: false},
  100102: {text: '观点关联的持仓参数无效', advice: '刷新持仓上下文后重试。', retryable: false},
  100103: {text: '分页游标已失效', advice: '丢弃游标并重新加载第一页。', retryable: true},
  100104: {text: '幂等键无效', advice: '生成新的合法幂等键后重试。', retryable: false},
  100105: {text: '关注目标参数无效', advice: '检查目标类型和标识，不要自动重试。', retryable: false},
  100106: {text: 'Square Lane 参数无效', advice: '修正 Lane 参数。', retryable: false},
  100112: {text: '备注内容或目标无效', advice: '检查目标并将备注控制在 64 个字符内。', retryable: false},
  100113: {text: '聪明钱地址参数无效', advice: '地址须原样传递且不携带链参数。', retryable: false},
  200100: {text: '观点不存在或已不可见', advice: '刷新当前页面。', retryable: false},
  200101: {text: '观点版本不存在或已不可见', advice: '刷新观点内容。', retryable: false},
  200103: {text: '关联持仓不存在', advice: '返回持仓列表并刷新。', retryable: false},
  200104: {text: '该地址未被收录为可关注的聪明钱', advice: '不要自动重试。', retryable: false},
  420100: {text: '同一幂等键提交了不同内容', advice: '使用新的幂等键重新提交。', retryable: false},
  420101: {text: '观点已经在其它位置更新', advice: '重拉最新版本后再编辑。', retryable: true},
  430100: {text: '不能关注自己', advice: '隐藏本人的关注入口。', retryable: false},
  430101: {text: '当前用户不可参与社交操作', advice: '停止重试并联系支持。', retryable: false},
  430103: {text: '该持仓已经发布过观点', advice: '改用 Update Opinion。', retryable: false},
  430106: {text: '备注数量已达到上限', advice: '清理不再使用的备注后重试。', retryable: false},
  500100: {text: '社交数据存储暂不可用', advice: '稍后重试；持续出现时联系运维。', retryable: true},
  500101: {text: '社交数据内部状态不一致', advice: '稍后重试；持续出现时附 trace_id 报障。', retryable: true},
  600100: {text: '观点未通过发布审查', advice: '修改正文或链接后重新提交。', retryable: false},

  // ── X（Twitter）账号绑定域 ──────────────────────────────────────────
  // 这一域里有三个码**不是"报错"而是流程分支**（200106 / 400103 / 100117），
  // 把它们当普通错误展示会把正常状态渲染成故障，或者把"必须重新发起"
  // 说成"重试即可" —— 后者最坑：重试一百次都是同一个码。
  100116: {
    text: 'code / state 缺失或格式非法',
    advice: '检查请求体：多半是从回调 URL 里只解析出了半边。',
    retryable: false,
  },
  100117: {
    text: 'X 授权码已被用过或已过期',
    advice: '**重新从 bind/start 发起**，不要重试本次请求 —— 授权码是一次性的。',
    retryable: false,
  },
  200106: {
    text: '没有生效的 X 绑定',
    advice: '这是正常状态不是错误：展示未绑定态，引导去绑定。',
    retryable: false,
  },
  400103: {
    text: 'state 无效、已过期（10 分钟）或不属于当前用户',
    advice:
      '**重新从 bind/start 发起**。同一份 {code,state} 提交第二次也是这个码 —— state 第一次提交时就被消费了。',
    retryable: false,
  },
  420103: {
    text: '近 24 小时绑定次数已达上限（滚动窗口，不是自然日）',
    advice: '稍后再试。**不要自动重试** —— 重试只会把窗口继续填满。',
    retryable: false,
  },
  430108: {
    text: '当前用户已经绑定了 X 账号',
    advice: '先解绑再绑；同时刷新本地绑定态（本地显示"未绑定"说明它是陈旧的）。',
    retryable: false,
  },
  430109: {
    text: '该 X 账号已被其他用户绑定',
    advice: '换一个 X 账号，或让原主先解绑。**不要自动重试。**',
    retryable: false,
  },
  500105: {
    text: 'X 上游故障',
    advice: '可稍后重试；持续如此附 trace_id 报障。',
    retryable: true,
  },

  // ── 邀请 / 准入域（invite.md，2026-09-06 错误码重排后） ────────────────
  100124: {
    text: '邀请参数非法：码空 / 格式不合 / 以 @ 开头；limit>50 / 坏 cursor；或登录时码超 32 字节',
    advice: '本地校验与服务端分岔（前端 bug）或 cursor 已坏：改参数，坏 cursor 丢弃重拉首页。',
    retryable: false,
  },
  200108: {
    text: '邀请码不存在或持有人不可作上级（未认领 / 冻结 / 封禁 / 注销 / 不在树里，五者不区分）',
    advice: '输入框提示「邀请码不存在或不可用」，不重试。',
    retryable: false,
  },
  420105: {
    text: '试码超限（登录带码 / bind 带码）',
    advice: '按 metadata.retry_after_seconds（字符串，秒）倒计时，期间禁用提交。',
    retryable: false,
  },
  430111: {
    text: '已绑定：已准入账号再调 bind，或已注册账号带入场码登录',
    advice: '前者回到 /v1/invite/status 重判；后者去掉 entry_code 重登。',
    retryable: false,
  },
  430112: {
    text: 'bind 的码指向自己或会成环',
    advice: '提示「不能填自己的码」，不重试。',
    retryable: false,
  },
  430115: {
    text: '登录 / bind：不带邀请码且服务端没开默认绑定（登录时无 JWT）',
    advice: '弹邀请码页，用**同一个 identity token** 带 invite_code 重调登录，不要重走 Privy。',
    retryable: false,
  },
  430116: {
    text: '登录：带了邀请码但不存在 / 不可作上级（无 JWT）',
    advice: '输入框报错，核对后重输。',
    retryable: false,
  },
  430117: {
    text: '独占期（或未开放期）且邮箱匹配不上冻结名单（无 JWT）',
    advice: '弹入场码页，用同一个 identity token 带 entry_code 重调登录。',
    retryable: false,
  },
  430118: {
    text: '入场码不存在 / 已撤销 / 已过期（服务端不区分）',
    advice: '提示核对后重输，不自动重试。',
    retryable: false,
  },
  430119: {
    text: '入场码对应的名额已被别的账号认领，已转人工',
    advice: '引导联系客服，不重试。',
    retryable: false,
  },
  430120: {
    text: '名额被运营冻结',
    advice: '引导联系客服。',
    retryable: false,
  },
  430121: {
    text: '独占期（含未开放期）内调 bind',
    advice: '「当前阶段暂不可进入」，稍后重新调 /v1/invite/status。',
    retryable: false,
  },
  500109: {
    text: '给本人发邀请码时连续撞码（服务端 Redis set 异常）',
    advice: '提示稍后重试，不自动重放。',
    retryable: false,
  },

  // ── 个人资料 / 设置域（user.md / settings.md） ──────────────────────────
  100111: {
    text: '资料参数非法（username / nickname / language 形态错；bio 缺席 / 超长 / 非法字符）',
    advice: '本地校验与后端分岔了，修前端；提示文案由前端按端点给。',
    retryable: false,
  },
  100121: {
    text: 'onboarding feature 不在后端在册清单里',
    advice: '检查是否照抄了回包里的 feature；不要自动重试。',
    retryable: false,
  },
  100123: {
    text: '设置值 / 头像来源 / 导入字段 / 导出链名或地址不合法',
    advice: '本地校验分岔了，修前端；改参数，不重试。',
    retryable: false,
  },
  420104: {
    text: '头像 / 简介 / handle 修改次数到上限（滚动窗口）',
    advice: '按 metadata.retry_after_seconds 显示倒计时，**不要自动重试**。',
    retryable: false,
  },
  430105: {
    text: '用户名已被占用（大小写不敏感）',
    advice: '提示换一个用户名。不要自动重试 —— 即使预检刚说过可用也要保留这个分支。',
    retryable: false,
  },
  500107: {
    text: '设置存储不可用（部署事实）',
    advice: '稍后重试，可提示「设置暂不可用」。',
    retryable: true,
  },

  // ── X 绑定 Privy 通道（x-import.md §6.3） ──────────────────────────────
  420106: {
    text: '（Privy 通道）上一次绑定拉取仍在处理中',
    advice: '等 1~2 秒取第一个请求的结果，不要重试。',
    retryable: false,
  },
  420107: {
    text: '（Privy 通道）拉取成功后的短窗内重复请求',
    advice: '提示稍后再试；已绑定用户恒不触发。',
    retryable: false,
  },
  500108: {
    text: '（Privy 通道）Privy 返回的 X 档案缺 username',
    advice: '提示稍后重试，或改走官方 X OAuth 通道（档案更全）。',
    retryable: true,
  },
};

export function codeInfo(code: number): CodeInfo | undefined {
  return CODES[code];
}
