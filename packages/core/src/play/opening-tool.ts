export const PROPOSE_OPENING_TOOL_NAME = 'propose_opening';

export const PROPOSE_OPENING_DESCRIPTION = '提交这一局的开场正文、推荐行动、场景、变化和状态栏初始值。';

const CHANGES_DESCRIPTION =
  '每行一个 JSON。引用方案里的人物和事物写 @编号；引用本次新写的事实，先给那行起一个 "id"（如 "f1"），再写这个 id。para 是出处在正文里的段号，从 1 起。主角已经在方案里，不要新增主角。' +
  '每个人物位置用一行 new_entity 登记一个具体的人，加上 "slot":"位置编号"。' +
  '可用的类型：\n' +
  '{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，正文或选项会写到它时必填","profile":"一句话档案","appearance":"短卷发，左眉有一道浅缺口，穿深色短外套","para":"1"}\n' +
  '{"type":"name","entity":"@2","name":"称呼","holder":"@1","para":"2"}\n' +
  '{"type":"event","subject":"@2","object":"@1","statement":"一句话","witnesses":"@1,@2","para":"2"}\n' +
  '{"type":"trait","subject":"@2","key":"特征名","statement":"一句话","para":"2"}\n' +
  '{"type":"relation","subject":"@1","object":"@2","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}\n' +
  '{"type":"promise","subject":"@2","object":"@1","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}\n' +
  '{"type":"knowledge","fact":"f1","holder":"@1","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"@2","para":"3"}\n' +
  '引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。\n' +
  '人物行可以带 appearance。用一行写此刻能看到的长相、身形、衣着或显眼特征，最多 300 字。看不清时省略。形象里不写真名、身份、来历和秘密。\n' +
  '开场里的 event 必须写明 witnesses。';

export const PROPOSE_OPENING_PARAMETERS = {
  type: 'object',
  properties: {
    prose: { type: 'string', description: '开场正文，段落之间空一行' },
    options: {
      type: 'string',
      description: '推荐行动，每行一个 JSON：{"text":"…"}。【行动提示】要求提醒时写 {"text":"…","hint":"…"}',
    },
    place: { type: 'string', description: '开场结束时主角所在的地点' },
    time: { type: 'string', description: '开场结束时的故事时间' },
    present: {
      type: 'string',
      description: '开场结束时在场的人物，写 @编号 或本次新增人物的名字，用逗号分隔。只有主角时留空',
    },
    changes: { type: 'string', description: CHANGES_DESCRIPTION },
    state: {
      type: 'string',
      description:
        '开局时状态栏的值，每行一个 JSON。数字、阶段、文字栏目：{"key":"栏目 key","value":"值","visible":"true|false"}；清单栏目每个条目一行：{"key":"栏目 key","item":"条目","status":"open"}。没写的栏目用方案里的开局值；没有要改的填空字符串',
    },
  },
  required: ['prose', 'options', 'place', 'time', 'present', 'changes', 'state'],
  additionalProperties: false,
} as const;
