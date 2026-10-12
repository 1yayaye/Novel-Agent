// These excerpts are reviewed against immutable upstream commits; importing never fetches reference code.
export const TAVERN_CONVERSION_REFERENCE = {
  version: '2026-10-12.1',
  sources: [
    {
      name: 'SillyTavern variable macros',
      revision: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      url: 'https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/macros/definitions/variable-macros.js'
    },
    {
      name: 'Tavern Helper macro-like substitutions',
      revision: 'c0196caee03955aa39e00db1a2623b2591bd3c6f',
      url: 'https://github.com/N0VI028/JS-Slash-Runner/blob/c0196caee03955aa39e00db1a2623b2591bd3c6f/src/function/macro_like.ts'
    },
    {
      name: 'Tavern Helper registered macros',
      revision: 'c0196caee03955aa39e00db1a2623b2591bd3c6f',
      url: 'https://github.com/N0VI028/JS-Slash-Runner/blob/c0196caee03955aa39e00db1a2623b2591bd3c6f/src/macro.ts'
    }
  ],
  semantics: `经固定源码核对的语义：
SillyTavern 的 setvar 设置局部变量并返回空文本；getvar 读取当前局部变量。setglobalvar/getglobalvar 使用独立全局作用域，不能与局部变量混为一谈。addvar 为数字相加或字符串追加；incvar/decvar 修改并返回新值。getvarkey/setvarkey 操作对象或数组中的键。求值顺序、启用声明和持久状态会影响结果，未提供状态时不得凭空补值。
Tavern Helper 的 get_{message|chat|character|preset|global}_variable::path 从指定作用域读取嵌套路径。路径先做 HTML 实体反转义，缺失值为 null；递归忽略以 $ 开头的键。字符串直接返回，其他值用 JSON.stringify 返回。
format_{message|chat|character|preset|global}_variable::path 对非字符串使用 YAML，保留前缀缩进；字符串直接返回。_quoted 变体对非字符串的 YAML 字符串值加引号。message 作用域使用当前消息，或最近带变量对象的消息。
registerMacroLike 可注册任意正则与 JavaScript 替换函数；不能仅根据双花括号名称推定含义。助手还注册 userAvatarPath/charAvatarPath 图像路径宏。
以上资料不是完整酒馆规格。其他宏、扩展、事件及 API 的语义若不能从源文件和这些资料确认，必须标记不确定或不支持。文件中声称需要插件不等于其中所有宏都由该插件提供。`
}
