import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export const DEFAULT_CREATIVE_RULES = `# 全书创作准则

遵循本作品已确认的人物、世界观、事件、时间线与作者意图。角色行动应有符合其已知信息、目标、关系和处境的理由；区分事实、角色判断与尚未确认的构想。

延续作品已有文风和叙述视角，根据场景需要安排动作、对白、环境与心理描写。语言清楚自然，细节服务人物和情节，避免重复解释与无目的铺陈。

续写承接前文，改写遵循作者指定范围，润色保留事件、人物意图和信息内容。作者本次明确要求优先；存在无法确定的关键事实时保留不确定性，不自行补成既定设定。
`

export type DefaultPresetDef = {
  taskType: 'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'style_distill' | 'book_summary' | 'chat'
  name: string
  instruction: string
}

export const DEFAULT_INSTRUCTION_PRESETS: DefaultPresetDef[] = [
  {
    taskType: 'continue',
    name: '承接前文续写',
    instruction: '从前文结束处承接，结合作者意图和已确认大纲推进当前场景。延续已有文风、视角与人物状态，按场景重要程度分配篇幅，让动作、对白、心理与环境各自发挥作用。输出连贯正文。'
  },
  {
    taskType: 'continue',
    name: '行动与对话续写',
    instruction: '围绕当前人物要做的事和要说的话推进场景，交代必要的位置、阻碍与行动后果。保持角色各自的说话习惯与信息边界，心理描写按场景需要使用，不强行制造冲突或转折。'
  },
  {
    taskType: 'continue',
    name: '人物体验续写',
    instruction: '延续作品当前叙述视角，写出焦点人物对事件的感受、理解与选择。区分其已知信息、记忆、推测和误解；其他人物的内心是否可写由作品既定视角决定。不要为加强情绪新增未确认经历。'
  },
  {
    taskType: 'polish',
    name: '语言与节奏润色',
    instruction: '改善目标文字的准确性、句段节奏与衔接，削减重复、含混和无目的解释，保留有作用的心理与修辞。保持原有事件、人物意图、信息、叙述视角和情节顺序，不通过新增动作或事件美化表达。'
  },
  {
    taskType: 'polish',
    name: '对白与人物表达润色',
    instruction: '使对白和人物表达更符合已有身份、关系与说话习惯，改善指代和动作衔接。保留每句话的信息与意图、已有关系和行为，不凭语气改写人物动机，不新增肢体接触或关系进展。'
  },
  {
    taskType: 'rewrite',
    name: '叙述组织改写',
    instruction: '依照作者本次要求重组指定片段的叙述顺序、重心与表达。保留未被授权改变的事件、人物关系、信息与设定；延续既有视角，只有作者明确要求时才改变视角。'
  },
  {
    taskType: 'rewrite',
    name: '场景节奏改写',
    instruction: '调整指定场景的铺垫、展开与收束，使重要选择和信息变化得到合适篇幅，压缩重复过渡。遵循作者授权范围，不默认增加危机、伤害、反转或新剧情；安静场景也可通过认识与关系变化推进。'
  },
  {
    taskType: 'style_distill',
    name: '文风蒸馏',
    instruction: '依据原文证据归纳语言、句式、段落、叙事距离、对白、动作、心理与节奏特征。区分反复出现的规律、局部做法与不确定判断，输出可用于参考的写作规则，不把单次现象变成绝对禁令，不复述剧情或照抄原文。'
  },
  {
    taskType: 'book_summary',
    name: '全书事实与结构总结',
    instruction: '按原文顺序整理主线、角色变化、世界观、关系、时间线、伏笔与未解问题，保留跨章节因果。区分已发生事件、角色说法、推测与未证实线索，不补写后续剧情。'
  },
  {
    taskType: 'chat',
    name: '剧情方向推敲',
    instruction: '结合已有剧情与作者意图，讨论可行的发展方向，说明各方案的动机、前置条件、收益与代价。将建议明确标为待作者确认的构想，不写入既定事实；需要澄清时聚焦影响后续选择的问题。'
  },
  {
    taskType: 'chat',
    name: '人物动机与互动推敲',
    instruction: '根据人物已有行为、信息、目标与关系讨论合理反应，区分文本证据与解释假设。允许真诚、误解、犹豫与日常互动，不默认所有言行都有隐秘目的；提出方案供作者选择。'
  },
  {
    taskType: 'knowledge',
    name: '人物与设定提取',
    instruction: '从目标原文提取角色、势力、地点、道具、世界规则与关系变化，保留来源依据。区分客观事件、人物持有信息、误解与未确认说法；只更新原文支持的信息，不推断未来结果。'
  },
  {
    taskType: 'knowledge',
    name: '事件与伏笔状态梳理',
    instruction: '梳理当前原文的已发生事件、阶段进度、新出现线索、已回收伏笔与未解问题，并保留时间和因果联系。尚未证实的伏笔解释明确标为推测，不把可能的发展方向记录为事实。'
  },
  {
    taskType: 'report',
    name: '叙事与表达评估',
    instruction: '根据原文证据评估人物因果、视角一致性、信息组织、对白、场景节奏与语言表达。指出影响阅读的具体问题与位置，区分事实矛盾、表达问题和风格偏好；必要时给出局部修改建议，不以固定句式、量词次数或单一文风作为通用合格标准。'
  }
]
export type DefaultStyleSampleDef = {
  name: string
  tags: string[]
  content: string
}

export const DEFAULT_STYLE_SAMPLES: DefaultStyleSampleDef[] = [
  {
    name: '🦊 动作张力与临场白描（狐神抚范例）',
    tags: ['白描', '动作张力', '临场感', '高冲突'],
    content: `尖啸声——金属划破大气层的惨叫。

浓烟从扭曲的逃生舱口翻涌而出。
大雨倾盆，雨点打在滚烫的金属舱壁上，蒸腾起刺鼻的白色水汽。
你浑身是血，从残骸中挣扎着爬出来，一脚踩进泥泞的地里。
手里攥着一把卷刃的玻璃钢匕首，近处突然传来了急促的奔跑声。

一扑一拉，用全身的重量，将她硬生生拖倒在地。
她的嘴被按住，只发出了一声急促的闷叫。刀尖直奔咽喉而去。
但她的反应极快——被按倒的一瞬间，一只手直接抓住了刀刃，死死攥住，另一只手立刻护住了自己的脖颈。
刀刃割开了手心。

树林另一头，原本还在缓步靠近的紫色身影爆射而来。
军靴每一次砸向地面，都蹬进泥泞里，溅起大片的泥水。
没有瞄准，全凭肌肉记忆。
她的身体如同压缩到极限的高磅弹簧突然炸开。
一把长刀向前突刺，另一只手将反贴在背后的霰弹枪瞬间抽出。
枪口在半空划过一道弧线，咬住眉心。`
  },
  {
    name: '🍃 沉浸式环境与微动作白描（留白范例）',
    tags: ['白描', '环境留白', '日常感官', '微动作'],
    content: `千代子跪坐的身体微微僵了一下，眼睫毛极快地颤了颤。

“这是自然，陛下请随起身来。”
她用双手撑着膝盖，动作标准地站起身。转身拉开那扇画着松鹤的纸门。
走廊里的光线依然很暗。远处的院子里偶尔能听到一两声俄国女兵的大嗓门。

千代子走在前方。
走得很慢。
脚踝露在外面，那双精巧的草编凉鞋踩在老旧的木板上，发出节奏规律的回响。
这栋旅馆的结构出奇的深。
越往里走，空气就越潮湿。挂在窗棂上的蜘蛛网都沾着水珠。

“祖父特意在后院留了一处私汤……外人不知晓。”
伸手推开走廊尽头的一扇木门。
浓烈的硫磺味夹杂着热气扑面而来。木门后是一个露天的小回廊，外面是一处被竹篱笆和红松林围住的露天温泉。`
  }
]

export function seedDefaultCreativePresets(database: Database.Database): void {
  const now = Date.now()

  // 1. Creative Rules
  const meta = database.prepare('SELECT creative_rules FROM project_meta LIMIT 1').get() as
    | { creative_rules: string }
    | undefined
  if (meta && (!meta.creative_rules || meta.creative_rules.trim().length === 0)) {
    database
      .prepare('UPDATE project_meta SET creative_rules = ?, updated_at = ?')
      .run(DEFAULT_CREATIVE_RULES, now)
  }

  // 2. Instruction Presets
  const presetCount = (
    database.prepare('SELECT count(*) as count FROM instruction_preset').get() as {
      count: number
    }
  ).count
  if (presetCount === 0) {
    const insertPreset = database.prepare(
      'INSERT INTO instruction_preset(id, task_type, name, instruction, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    )
    for (const p of DEFAULT_INSTRUCTION_PRESETS) {
      insertPreset.run(randomUUID(), p.taskType, p.name, p.instruction, now, now)
    }
  }

  // 3. Style Samples
  const sampleCount = (
    database.prepare('SELECT count(*) as count FROM style_sample').get() as { count: number }
  ).count
  if (sampleCount === 0) {
    const insertSample = database.prepare(
      'INSERT INTO style_sample(id, name, content, tags_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    )
    for (const s of DEFAULT_STYLE_SAMPLES) {
      insertSample.run(randomUUID(), s.name, s.content, JSON.stringify(s.tags), now, now)
    }
  }
}

