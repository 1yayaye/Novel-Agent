import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatWorkflowStage, PromptSlot } from '../shared/project'

export const DEFAULT_CREATIVE_RULES = `# 全书核心创作准则与行文规范

## 一、核心原则：真实感与白描化（Show, Don't Tell）
1. **情感外化呈现**：角色内心状态只能通过身体动作、生理反应、视线落点与呼吸停顿呈现。禁止直接下定义（如“他感到悲伤”、“她很紧张”）。
2. **动词精准推进**：动作要有形状、重量、方向与物理阻力，以具体动词为核心，不靠抽象修饰词填充。
3. **伤害与生理真实**：身体创伤、疲惫与疼痛会实时限制角色行动，遵循客观人体的自然反应与恢复规律。

## 二、严格文风与去 AI 感规范（杀八股）
1. **句式禁忌**：
   - 严禁“全肯定对比”句式（“不是A而是B”、“并非A却是B”、“不像A更像B”）。
   - 严禁从句倒置（“如此……以至于……”、“当……的时候”），严格按“先因后果”的时间流推进。
   - 避免泛滥使用破折号“——”，多以逗号自然断句或句号落地。
   - 连续 SVO 结构或等长句必须适度打乱，保持呼吸节奏。
2. **细节与禁词约束**：
   - 全文严格控制“一+量词”（一下、一会儿、一阵、一个等）出现频率（单场景 ≤ 3次）。
   - 严禁滥用“那+量词”（那张、那件、那个等）及“x了x”叠词（看了看、顿了顿、想了想等）。
   - 严禁套路化比喻库（石子/泛起涟漪/古井无波/手术刀/热刀切黄油/搁浅的鱼/破布娃娃/断线风筝/达摩克利斯之剑等）。
   - 严禁说明书式类比（“这就好比……”、“这就像……”）与医学报告腔（表皮、毛细血管、心率加快等）。
3. **对白与收尾规范**：
   - 严禁对白余波（“这句话落下”、“话说完”、“话音刚落”），对白后直接承接动作、环境或留白。
   - 严禁“等待式结尾”（“在等你的回复”、“等待着你的回应”等），场景必须自然停在角色的动作、台词、离场或环境动静上。

## 三、世界观刚性与叙事中立
1. **防魅与现实检验**：主角或玩家角色的行为仅为“尝试”，必须经过情境、距离、持有资源与身份权限的逻辑检验；NPC 具备独立动机与利益边界，绝不无端屈服或降智配合。
2. **叙事客观中立**：叙述者保持客观摄像机机位，不主观替角色脑补恶意、支配、试探或霸总式心理动机。
3. **严格限制性视角**：遵守单一主控角色的感官边界（目之所视、耳之所闻），未经验证的信息不可全知预判。
`

export type DefaultPresetDef = {
  taskType: 'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat'
  name: string
  instruction: string
}

export const DEFAULT_INSTRUCTION_PRESETS: DefaultPresetDef[] = [
  // 1. 续写类 (continue)
  {
    taskType: 'continue',
    name: '🦊 智能长短文 · 动态节拍续写',
    instruction: `【任务：正文智能续写】
请承接上文剧情与上下文，根据场景类型自适应控制篇幅与推进节奏：
1. 日常交互/简要过渡：精炼交代动作与微反应，点到为止；
2. 剧情推进/关系变化：充分展开感官细节与对白交错，让沉默与停顿具备分量；
3. 冲突高潮/重大转折：用具体物理动作撑张力，用身体受力与环境反馈支撑情绪。

【硬性规则】：
- 严格按先因后果时间线推进，严禁“不是A而是B”式对比与因果倒置。
- 单行聚焦核心微动作，动词有力，禁止堆砌套路比喻（如涟漪、手术刀等）。
- 禁止使用“在等你的回复”等等待式收尾，自然收束在角色的动作、对白或具体环境动静上。`
  },
  {
    taskType: 'continue',
    name: '🔪 影视白描 · 短句快切续写',
    instruction: `【任务：影视级白描快切续写】
1. 核心动作一行动词推进，单行最多不超过两句，长短句交替形成呼吸感。
2. 不描写心理旁白，情绪全部通过手指、视线、站姿、呼吸、重心与物理停顿表达。
3. 关键动作拆解为起手、发力、碰撞与受力后果，冲突场景以短句快切推进。
4. 绝不使用套路化比喻与医学报告腔，所见即所得。`
  },
  {
    taskType: 'continue',
    name: '👣 严格限制视角 · 单主控深度续写',
    instruction: `【任务：严格限制性视角续写】
1. 严格锁定当前主控角色的感知边界：只能描写其双眼所见、双耳所闻与身体直接触感，未知之事绝不上帝全知。
2. 在场其他角色只描写外显言行，禁止直接窥探或定义他人内心。
3. 叙述语调与当前主控角色的性格、认知及知识边界深度绑定。`
  },

  // 2. 润色类 (polish)
  {
    taskType: 'polish',
    name: '✨ 深度去AI感 · 白描质感润色',
    instruction: `【任务：正文去AI感白描润色】
对目标选区文本进行深度润色与质感重塑，严格执行以下修正：
1. 【句式清洗】：彻底删除所有“不是……而是……”、“并非……却是……”、“不像……更像……”结构；消除“当……的时候”、“如此……以至于……”等从句倒置。
2. 【去套路化】：剔除所有“涟漪/古井/手术刀/断线风筝/搁浅的鱼”等AI高频套路比喻；删除说明书式类比。
3. 【情感具象】：将所有直接下定义的情绪词（“他感到紧张/愤怒/释然”）转化为手指、呼吸、视线等具体的身体物理动作。
4. 【消除对白余波】：删除“话音刚落”、“话说完”、“这句话散开”等过渡废话；删除对白后的自我解释句。
5. 【精简量词叠词】：将“看了看/想了想/顿了顿”等叠词替换为单个精准动词，精简“一+量词”与“那+量词”的冗余堆砌。`
  },
  {
    taskType: 'polish',
    name: '🛡️ 叙事去油 · 关系与语气质感润色',
    instruction: `【任务：叙事去油与中立质感润色】
1. 消除霸总式油腻台词与肢体侵犯描写（如无故壁咚、捏下巴、冷笑定性），让权力角色的压迫感回归体制、资源与专业沉稳。
2. 保持叙事中立，清除叙述者对角色意图的主观阴谋化/暧昧化过度脑补。
3. 修正所有不符合生理规律与物理受力的违和描写，保持动作与对话的现实质地。`
  },

  // 3. 改写类 (rewrite)
  {
    taskType: 'rewrite',
    name: '🔄 多视角交接 · POV重构改写',
    instruction: `【任务：多视角POV交接改写】
将目标片段以指定角色的视角进行彻底重构：
1. 确立排他性主控：整段仅深入该角色的主观感知、生理直觉与思维推测。
2. 视角切换遵循物理交接桥梁（目光对视、肢体接触、递物、转场动作），切换后另起新段。
3. 原文中的全知旁白与他人心理描写全部降级为客观外显的动作与表情观察。`
  },
  {
    taskType: 'rewrite',
    name: '⚡ 场景张力 · 动作冲突重写',
    instruction: `【任务：动作张力与高冲突重写】
1. 削减冗长拖沓的静态环境说明，以突发的动作碰撞或危机事件切入。
2. 提升动词密度，打碎长句结构，用短句链条强化压迫感与临场感。
3. 强调每一次发力、阻力与伤害后果，避免悬浮虚招。`
  },

  // 4. 工作台对话 (chat)
  {
    taskType: 'chat',
    name: '🎬 导演视角 · 剧情推敲与反套路推翻',
    instruction: `【任务：导演视角构思与剧情推敲】
在探讨剧情走向与场景设计时，请按以下框架进行推演：
1. 【感知与边界核定】：梳理在场各角色的位置、已知情报与绝不可知的信息禁区。
2. 【反套路推翻】：主动列出当前场景最容易落入的 3 个脸谱化剧情/人物俗套，并给出推翻策略。
3. 【核心节拍设计】：设计 2~3 个具备信息增量、权力距离偏移或关系转折的具体行动节拍。
4. 【潜文本挖掘】：分析关键台词的表层意图 vs 底层真实动机。`
  },
  {
    taskType: 'chat',
    name: '👤 角色深度解剖 · 身体与动机分析',
    instruction: `【任务：角色深度动机解剖】
针对指定角色或人物互动进行深度解剖：
1. 核心性格内核与认知天花板（身份/时代/背景限制）。
2. 面具 vs 底层真实渴望：其外在言行在试图掩饰什么，身体小动作（肩/视线/重心）在出卖什么。
3. 拒绝扁平工具化，给出符合其人设利益与尊严的独立反应方案。`
  },

  // 5. 设定与知识库 (knowledge)
  {
    taskType: 'knowledge',
    name: '🧠 实体认知边界与关系网提取',
    instruction: `【任务：实体认知与知识网络抽取】
从目标章节中提取角色、势力、道具等关键设定信息：
1. 提取角色核心特征、持有资源及其当前所处的知识/认知边界（知晓什么、误解什么）。
2. 梳理人物之间的权力关系与态度变化，区分客观发生的事实与角色的主观推测。
3. 整理新增的世界观规则与物理常识。`
  },
  {
    taskType: 'knowledge',
    name: '📌 伏笔埋设与大纲阶段梳理',
    instruction: `【任务：大纲阶段与伏笔状态梳理】
按照以下结构梳理当前章节的脉络信息：
- #主线进度：一句话概括当前推进节点；
- #已完成事件：列出本章完成的关键转折；
- #当前阶段 / #下一阶段：明确剧情阶段划分；
- #伏笔状态：列出新埋设或已回收的伏笔名称及线索；
- #剧情走向：后续 1~2 个自然延伸的发展方向。`
  },

  // 6. 报告分析 (report)
  {
    taskType: 'report',
    name: '🔍 文学质感与去AI八股诊断',
    instruction: `【任务：全篇文学质感与去AI感深度评估】
对章节正文进行多维度诊断：
1. 【AI八股与句式硬伤】：检查是否存在“不是……而是”、因果倒置、破折号泛滥、“一+量词”超标、叠词堆叠等问题。
2. 【比喻与修辞审查】：定位套路化比喻（涟漪、手术刀等）及说明书式类比。
3. 【视角与感知违规】：检查是否出现上帝视角读心、NPC心理越界或全知总结。
4. 【结尾与停顿检验】：检查是否存在“等待式收尾”或对白余波废话。
5. 给出具体的修改建议与示范改写。`
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

export function seedDefaultCreativePresets(database: Database.Database, force = false): void {
  const now = Date.now()

  // 1. Creative Rules
  const meta = database.prepare('SELECT creative_rules FROM project_meta LIMIT 1').get() as
    | { creative_rules: string }
    | undefined
  if (meta && (!meta.creative_rules || meta.creative_rules.trim().length === 0 || force)) {
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
  if (presetCount === 0 || force) {
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
  if (sampleCount === 0 || force) {
    const insertSample = database.prepare(
      'INSERT INTO style_sample(id, name, content, tags_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    )
    for (const s of DEFAULT_STYLE_SAMPLES) {
      insertSample.run(randomUUID(), s.name, s.content, JSON.stringify(s.tags), now, now)
    }
  }
}

export const DEFAULT_STAGE_PROMPT_SLOTS: PromptSlot[] = [
  // 1. 项目身份与架构设定
  {
    id: 'slot-project-identity',
    name: '项目身份与架构设定',
    enabled: true,
    role: 'system',
    content: '【项目身份与核心设定】\n你是一位资深小说主笔与剧情架构师。本项目是一部严谨的长篇连载小说，所有创作必须严格恪守已建立的人设、世界观逻辑与时间线连续性。',
    position: 'before_context',
    order: 1,
    trigger: 'always'
  },
  // 2. 长期白描与去AI感准则
  {
    id: 'slot-longterm-rules',
    name: '长期白描与去AI感准则',
    enabled: true,
    role: 'system',
    content: '【长期行文准则】\n1. 白描呈现（Show, Don\'t Tell）：情绪只能通过微动作、身体受力、呼吸停顿与视线呈现，禁止直接下定义。\n2. 去除AI腔：严禁“不是A而是B”对比、因果倒置、套路比喻（涟漪/手术刀等）与等待式收尾。\n3. 时间单向流：严格按先因后果自然推进。',
    position: 'before_context',
    order: 2,
    trigger: 'always'
  },
  // 3. 限知视角与感官边界 (POV)
  {
    id: 'slot-limited-pov',
    name: '限知视角与感官边界 (POV)',
    enabled: true,
    role: 'system',
    content: '【限知视角约束 (POV)】\n严格锁定当前主控角色的感知边界。只能描写其双眼所见、双耳所闻与身体直接触感；未经主控角色亲自见证或推知的信息绝不上帝全知，在场其他角色只描写外显言行，严禁直接窥探他人内心。',
    position: 'after_context',
    order: 10,
    trigger: 'content'
  },
  // 4. 人物认知边界与独立动机
  {
    id: 'slot-character-boundaries',
    name: '人物认知边界与独立动机',
    enabled: true,
    role: 'system',
    content: '【人物认知边界与自主性】\n各角色具备独立动机、认知天花板与利益边界。角色绝不掌握超出其身份和经历的情报，绝不无端配合或强行降智，一切互动必须经受情境与资源现实检验。',
    position: 'after_context',
    order: 20,
    trigger: 'always'
  },
  // 5. 阶段输出协议 - direction
  {
    id: 'slot-stage-direction',
    name: '阶段输出协议：方向确认',
    enabled: true,
    role: 'system',
    content: '【阶段输出协议：方向确认 (direction)】\n请结合全书/分卷大纲、章节摘要与作者意图，梳理本章创作核心方向。输出格式必须包含：\n1. 本章核心事件与剧情定位\n2. 核心冲突与信息增量\n3. 最多 3 个待作者确认的关键问题或分支选项。',
    position: 'after_context',
    order: 30,
    trigger: 'direction'
  },
  // 6. 阶段输出协议 - chapter_outline
  {
    id: 'slot-stage-chapter-outline',
    name: '阶段输出协议：章大纲规划',
    enabled: true,
    role: 'system',
    content: '【阶段输出协议：章大纲规划 (chapter_outline)】\n输出结构化 Markdown 章大纲，必须严格包含以下六个模块：\n1. 【本章目标】：明确本章剧情使命与核心转折\n2. 【场景节拍】：按发生顺序划分 2~4 个具体场景与节拍\n3. 【人物与动机】：在场角色动机、行动与权力关系偏移\n4. 【冲突与信息增量】：核心对抗焦点与揭示的新信息\n5. 【连续性风险】：伏笔衔接、时间线与设定一致性检查\n6. 【结尾钩子】：本章结尾悬念或收束动作。',
    position: 'after_context',
    order: 30,
    trigger: 'chapter_outline'
  },
  // 7. 阶段输出协议 - content
  {
    id: 'slot-stage-content',
    name: '阶段输出协议：正文候选',
    enabled: true,
    role: 'system',
    content: '【阶段输出协议：正文生成 (content)】\n依据已确认的章大纲生成连贯正文候选。严格禁止在正文中夹带大纲、分析说明、选项或思维链文本；正文纯粹为小说叙事文本。',
    position: 'after_context',
    order: 30,
    trigger: 'content'
  },
  // 8. 连续性与前文呼应检查
  {
    id: 'slot-continuity-check',
    name: '连续性与前文呼应检查',
    enabled: true,
    role: 'system',
    content: '【连续性与前文呼应检查】\n确保当前情节与前文摘要、已确认事实及伏笔状态严格吻合，检查时间先后、人物在场状态与道具持有情况，避免前后矛盾。',
    position: 'after_context',
    order: 40,
    trigger: 'always'
  }
]

export function getDefaultStagePromptSlots(stage?: ChatWorkflowStage): PromptSlot[] {
  if (!stage) {
    return DEFAULT_STAGE_PROMPT_SLOTS.filter((s) => s.trigger === 'always')
  }
  return DEFAULT_STAGE_PROMPT_SLOTS.filter(
    (s) => s.trigger === 'always' || s.trigger === stage
  )
}

export const seedDefaultCreativeData = seedDefaultCreativePresets

