import { describe, expect, it } from 'vitest'
import {
  parseCreationOutput,
  parseDirectionOutput,
  parseChapterOutlineOutput,
  parseStageOutput
} from '../src/main/output-parser'

describe('T09: Output Parser & Derived Information Isolation', () => {
  describe('parseCreationOutput', () => {
    it('handles Category 1: Standard tagged outputs with complete XML tags', () => {
      const rawText = `
<thinking>
主角目前处于劣势，需要通过地形脱困。
感官锁定在手指触感和冷风。
</thinking>
<summary>
韩立借地形摆脱追兵，前往七玄门后山。
</summary>
<options>
1. 潜入药园寻找墨大夫
2. 藏身断崖等待天明
3. 伪装身份混入外门
</options>
<content>
寒风卷着碎雪刮过崖壁。

韩立五指扣紧岩缝，粗糙的石砺硌得指骨生疼。他屏住呼吸，听着下方杂乱的脚步声逐渐远去，才缓缓吐出一口白气。
</content>
`
      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.summary).toContain('韩立借地形摆脱追兵')
      expect(parsed.plotOptions).toEqual([
        '潜入药园寻找墨大夫',
        '藏身断崖等待天明',
        '伪装身份混入外门'
      ])
      expect(parsed.content).toBe('寒风卷着碎雪刮过崖壁。\n\n韩立五指扣紧岩缝，粗糙的石砺硌得指骨生疼。他屏住呼吸，听着下方杂乱的脚步声逐渐远去，才缓缓吐出一口白气。')
      expect(parsed.content).not.toContain('<thinking>')
      expect(parsed.content).not.toContain('<summary>')
      expect(parsed.content).not.toContain('<options>')
      expect(parsed.warnings.length).toBe(0)
    })

    it('handles Category 2: Completely untagged plain text prose', () => {
      const rawText = '山道弯弯，细雨如丝。\n\n韩立踏过青石板上的青苔，脚步沉稳无声。'
      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed.content).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.summary).toBeUndefined()
      expect(parsed.plotOptions).toBeUndefined()
      expect(parsed.warnings.length).toBe(0)
    })

    it('handles Category 3: Missing closing tags with subsequent tag transition', () => {
      const rawText = `<thinking>
需要描写身体受力与泥泞环境。
<content>
靴底深陷泥潭，拔出时发出沉闷的黏滞声。韩立压低身形，反手扣住剑柄。`

      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).toBe('靴底深陷泥潭，拔出时发出沉闷的黏滞声。韩立压低身形，反手扣住剑柄。')
      expect(parsed.content).not.toContain('<thinking>')
      expect(parsed.warnings.length).toBeGreaterThan(0)
      expect(parsed.warnings.some((w) => w.includes('未闭合'))).toBe(true)
    })

    it('handles Category 3: Unclosed <content> tag reaching EOF', () => {
      const rawText = '<content>夜色渐深，篝火噼啪作响。'
      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed.content).toBe('夜色渐深，篝火噼啪作响。')
      expect(parsed.warnings.length).toBeGreaterThan(0)
    })

    it('handles Category 4: Untagged Markdown sections with pure prose isolation', () => {
      const rawText = `### 【构思推演】
本段聚焦潜入过程中的声响控制。

### 【正文】
铁锁在掌心浸得冰凉。

韩立用细铁丝探入锁孔，指尖微颤，随着极轻的一声“咔哒”，锁舌应声弹开。

### 【剧情选项】
1. 立即推门而入
2. 侧耳倾听屋内动静
`
      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).toBe('铁锁在掌心浸得冰凉。\n\n韩立用细铁丝探入锁孔，指尖微颤，随着极轻的一声“咔哒”，锁舌应声弹开。')
      expect(parsed.plotOptions).toEqual([
        '立即推门而入',
        '侧耳倾听屋内动静'
      ])
      expect(parsed.content).not.toContain('【构思推演】')
      expect(parsed.content).not.toContain('【剧情选项】')
    })

    it('handles Category 5: Interleaved thinking and content with <Interleaving> wrapper', () => {
      const rawText = `<Interleaving>
<thinking>
第一段思考：确定环境与氛围，雨夜，古寺。
</thinking>
破庙外的暴雨丝毫没有停歇的意思，雨水顺着漏风的屋檐哗啦啦地砸落。韩立收拢衣袍，蹲在佛像背后。

<thinking>
第二段思考：推进动作，墨大夫递出汤药，试探心理。
</thinking>
墨大夫从暗影中转出身来，苍白枯槁的手指端着一碗散发着古怪腥甜味的黑褐色汤药，眼皮微抬，望了过来。
</Interleaving>`

      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).not.toContain('<Interleaving>')
      expect(parsed.content).not.toContain('</Interleaving>')
      expect(parsed.content).not.toContain('<thinking>')
      expect(parsed.content).not.toContain('</thinking>')
      expect(parsed.content).not.toContain('第一段思考')
      expect(parsed.content).not.toContain('第二段思考')
      expect(parsed.content).toContain('破庙外的暴雨丝毫没有停歇的意思')
      expect(parsed.content).toContain('墨大夫从暗影中转出身来')
    })

    it('handles Category 6: Multi-model CoT with thinking_left/right/director and choice tags (智脑-Z style)', () => {
      const rawText = `<thinking_left>
确认上一轮时空：神手谷药园，黄昏。墨大夫在场，检验韩立长春功修炼进度。
</thinking_left>
<thinking_right>
墨大夫的心理动机：迫切需要夺舍宿主，表面上慈眉善目关怀备至，眼底却暗藏审视。
韩立的应对策略：保持藏拙，故意将进度说得极其缓慢。
</thinking_right>
<thinking_director>
场景节奏：先静后动，通过药炉沸腾的咕嘟声烘托压抑氛围。
</thinking_director>
<content>
药炉里沸腾的汤药咕嘟作响，升腾起苦涩呛人的白汽。

墨大夫枯瘦的手指搭在韩立脉门上，指尖冰冷得像一条冬眠的毒蛇。韩立垂着眼帘，连呼吸都刻意放慢了半分。
</content>
<choice>
1. 坦白长春功已产生微弱气感
2. 谎称功法滞涩毫无进展
3. 转移话题询问草药辨识
</choice>`

      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).toBe('药炉里沸腾的汤药咕嘟作响，升腾起苦涩呛人的白汽。\n\n墨大夫枯瘦的手指搭在韩立脉门上，指尖冰冷得像一条冬眠的毒蛇。韩立垂着眼帘，连呼吸都刻意放慢了半分。')
      expect(parsed.content).not.toContain('<thinking_left>')
      expect(parsed.content).not.toContain('神手谷药园')
      expect(parsed.content).not.toContain('<choice>')
      expect(parsed.plotOptions).toEqual([
        '坦白长春功已产生微弱气感',
        '谎称功法滞涩毫无进展',
        '转移话题询问草药辨识'
      ])
    })

    it('handles Category 7: Custom thinking tags and fox_hugou outline and fox_selc options (狐神抚 style)', () => {
      const rawText = `<think_fox~>
狐裁思考：需要强化门规森严与少年求生欲的对冲。
</think_fox~>
<fox_hugou>
#主线进度 拜师第三日
#当前阶段 摸索灵根潜质
#下一阶段 夜探灵药园
</fox_hugou>
<content>
窗外竹影摇曳，夜风穿过窗棂吹得油灯忽明忽暗。韩立盘膝坐于木榻之上，掌心握着那一枚冰凉的铜绿小瓶。
</content>
<fox_selc>
1. 将小瓶藏入鞋底夹层
2. 趁夜将小瓶浸入后山溪水
</fox_selc>`

      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).toBe('窗外竹影摇曳，夜风穿过窗棂吹得油灯忽明忽暗。韩立盘膝坐于木榻之上，掌心握着那一枚冰凉的铜绿小瓶。')
      expect(parsed.content).not.toContain('<think_fox~>')
      expect(parsed.content).not.toContain('<fox_hugou>')
      expect(parsed.content).not.toContain('<fox_selc>')
      expect(parsed.outline).toContain('#主线进度 拜师第三日')
      expect(parsed.plotOptions).toEqual([
        '将小瓶藏入鞋底夹层',
        '趁夜将小瓶浸入后山溪水'
      ])
    })

    it('handles Category 8: Custom planning tags without explicit content wrapper (Izumi style)', () => {
      const rawText = `<konatan_planning~>
- 回顾当前情况：雨夜古庙
- 确定正文字数与节奏：推进两人对峙
</konatan_planning~>
寒雨连江，夜色如铁。

破庙内的残烛摇曳不定，将两人的影子拉得极长。`

      const parsed = parseCreationOutput(rawText)

      expect(parsed.rawOutput).toBe(rawText)
      expect(parsed).not.toHaveProperty('thinking')
      expect(parsed.content).toBe('寒雨连江，夜色如铁。\n\n破庙内的残烛摇曳不定，将两人的影子拉得极长。')
      expect(parsed.content).not.toContain('konatan_planning')
      expect(parsed.content).not.toContain('回顾当前情况')
    })

    it('handles malformed / empty input gracefully without throwing', () => {
      const parsedEmpty = parseCreationOutput('')
      expect(parsedEmpty.content).toBe('')
      expect(parsedEmpty.rawOutput).toBe('')

      const parsedNull = parseCreationOutput(null as any)
      expect(parsedNull.content).toBe('')
    })
  })

  describe('parseDirectionOutput', () => {
    it('parses XML tagged direction and questions', () => {
      const raw = `
<direction>
本章核心推进韩立拜入七玄门后的首次试炼，确立与厉飞雨的竞争与结盟契机。
</direction>
<questions>
1. 试炼中是否直接展现掌天瓶异象？
2. 厉飞雨出场时是敌对还是中立？
3. 试炼名次是否需要故意隐藏实力？
</questions>
`
      const parsed = parseDirectionOutput(raw)
      expect(parsed.direction).toContain('本章核心推进韩立拜入七玄门后的首次试炼')
      expect(parsed.questions.length).toBe(3)
      expect(parsed.questions[0]).toContain('试炼中是否直接展现掌天瓶异象？')
      expect(parsed.questions[1]).toContain('厉飞雨出场时是敌对还是中立？')
      expect(parsed.questions[2]).toContain('试炼名次是否需要故意隐藏实力？')
      expect(parsed.rawOutput).toBe(raw)
    })

    it('parses Markdown formatted direction and questions', () => {
      const raw = `【核心方向】
本章重点交代七玄门门规与神手谷环境，烘托悬疑暗流。

【待确认问题】
1. 墨大夫何时开始暗中测试韩立灵根？
2. 张铁的去向是否在本章埋下伏笔？
`
      const parsed = parseDirectionOutput(raw)
      expect(parsed.direction).toContain('七玄门门规与神手谷环境')
      expect(parsed.questions.length).toBe(2)
      expect(parsed.questions[0]).toContain('墨大夫何时开始暗中测试韩立灵根？')
      expect(parsed.questions[1]).toContain('张铁的去向是否在本章埋下伏笔？')
    })
  })

  describe('parseChapterOutlineOutput', () => {
    it('parses 6-module structured chapter outline', () => {
      const raw = `
<chapter_outline>
【本章目标】
交代神手谷拜师背景，确立师徒间的微妙信任危机。

【场景节拍】
1. 神手谷初见：墨大夫严苛考核，韩立通过草药辨识。
2. 赠药传功：传授长春功口诀，暗藏试探。
3. 夜宿草屋：韩立夜读医书，察觉药渣异常。

【人物与动机】
- 韩立：求生求学，保持警惕与藏拙。
- 墨大夫：急于寻找夺舍宿主，表面关照实则审视。

【冲突与信息增量】
长春功修炼门槛过高，韩立发现自身进度异常缓慢却触发神秘玉佩反应。

【连续性风险】
前文提及的五里沟家书需在此处有呼应。

【结尾钩子】
韩立在药园土壤中捡到一枚散发微光的铜绿小瓶。
</chapter_outline>
`
      const parsed = parseChapterOutlineOutput(raw)
      expect(parsed.outline).toContain('【本章目标】')
      expect(parsed.modules.goal).toContain('交代神手谷拜师背景')
      expect(parsed.modules.sceneBeats).toContain('1. 神手谷初见')
      expect(parsed.modules.characters).toContain('求生求学')
      expect(parsed.modules.conflicts).toContain('长春功修炼门槛')
      expect(parsed.modules.continuityRisk).toContain('五里沟家书')
      expect(parsed.modules.endingHook).toContain('铜绿小瓶')
      expect(parsed.rawOutput).toBe(raw)
    })
  })

  describe('parseStageOutput dispatcher', () => {
    it('dispatches to direction, chapter_outline, and content accordingly', () => {
      const dirRes = parseStageOutput('direction', '【核心方向】主线【待确认问题】1. 问题A')
      expect((dirRes as any).questions).toBeDefined()

      const outlineRes = parseStageOutput('chapter_outline', '【本章目标】目标【场景节拍】节拍')
      expect((outlineRes as any).modules).toBeDefined()

      const contentRes = parseStageOutput('content', '<content>正文内容</content>')
      expect((contentRes as any).content).toBe('正文内容')
    })
  })
})
