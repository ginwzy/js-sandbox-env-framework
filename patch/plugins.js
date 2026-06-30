/**
 * patch/plugins —— 填充 navigator.plugins / mimeTypes(经典 headless tell:length=0)。
 * Chromium 固定集(5 plugin × 2 mimeType);门控 host=chrome(WebView 真机为空)。
 * 经 mask.iface 自建四类(jsdom slot 取不到 length → 不能用原生 PluginArray)。
 */
import { chromeHost } from './gates.js';

const PDF_DESC = 'Portable Document Format';
const PLUGIN_NAMES = [
  'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
];
const MIME_TYPES = [
  { type: 'application/pdf', suffixes: 'pdf', description: PDF_DESC },
  { type: 'text/pdf', suffixes: 'pdf', description: PDF_DESC },
];

export default {
  name: 'plugins',
  after: ['navigator'],
  applies: chromeHost,
  apply({ window, mask }) {
    const defineMethods = mask.methods;
    // 类数组:索引 own(enumerable) + named(non-enumerable)。length 在 prototype accessor(实例无 own)。
    const fillCollection = (arr, items, keyOf) => {
      items.forEach((it, i) => Object.defineProperty(arr, i, { value: it, enumerable: true, configurable: true }));
      for (const it of items) {
        const k = keyOf(it);
        if (k && !(k in arr)) Object.defineProperty(arr, k, { value: it, enumerable: false, configurable: true });
      }
      return arr;
    };

    const Plugin = mask.iface('Plugin');
    const MimeType = mask.iface('MimeType');
    const PluginArray = mask.iface('PluginArray');
    const MimeTypeArray = mask.iface('MimeTypeArray');

    // length 原型 accessor(实例态:读 this 数连续整数索引)—— 三类容器共用一份 getter。
    const lengthGetter = function length() { let n = 0; while (n in this) n += 1; return n; };
    for (const C of [PluginArray, MimeTypeArray, Plugin]) mask.instAccessor(C.proto, 'length', lengthGetter);

    const collMethods = {
      item: [1, function item(i) { return this[i] ?? null; }],
      namedItem: [1, function namedItem(name) { return this[name] ?? null; }],
    };
    defineMethods(PluginArray.proto, { ...collMethods, refresh: [0, () => undefined] });
    defineMethods(MimeTypeArray.proto, collMethods);
    defineMethods(Plugin.proto, collMethods); // Plugin 本身是 mimeType 的类数组容器

    // mimeType 实例(enabledPlugin 稍后回填指向 plugins[0])。
    const mimeInstances = MIME_TYPES.map((m) => MimeType.create({ ...m, enabledPlugin: null }));

    // plugin 实例:每个含全部 mimeType(索引 + named by type),mimeType.enabledPlugin 反指。
    const pluginInstances = PLUGIN_NAMES.map((name) => {
      const plugin = Plugin.create({ name, filename: 'internal-pdf-viewer', description: PDF_DESC });
      fillCollection(plugin, mimeInstances, (mt) => mt.type);
      return plugin;
    });
    for (const mt of mimeInstances) mt.enabledPlugin = pluginInstances[0];

    const plugins = fillCollection(PluginArray.create({}), pluginInstances, (p) => p.name);
    const mimeTypes = fillCollection(MimeTypeArray.create({}), mimeInstances, (mt) => mt.type);

    // 覆盖 Navigator.prototype 的 plugins/mimeTypes accessor 为填充后的单例。
    mask.mixin(window.navigator, { plugins: () => plugins, mimeTypes: () => mimeTypes });
  },
};
