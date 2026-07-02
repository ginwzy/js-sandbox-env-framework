/**
 * run() 结果的序列化边界 —— realm.run() 的 value 可能是活的 window / DOM 节点 / 循环引用:
 * JSON.stringify 会抛、worker_threads postMessage 的 structured clone 会抛 DataCloneError。
 * 故凡要越"进程 stdout / 线程边界"的结果,先归一成 clone + JSON 安全的纯数据(不可序列化者替类型占位符,
 * 且始终保留 ok / missing)。CLI(stdout)、entry/worker(postMessage)、未来 HTTP 层共用此一处契约。
 */

/** @param {{ok:boolean, value?:any, error?:string, stack?:string, missing?:string[]}} out */
export function serializeResult(out) {
	const safe = { ok: !!out.ok, missing: out.missing ?? [] };
	if (out.ok) safe.value = toPlainData(out.value);
	else {
		safe.error = out.error;
		safe.stack = out.stack;
	}
	return safe;
}

/** 深拷成纯数据:clone/JSON 安全则原样;抛(循环 / DOM 图 / 函数 / BigInt)则替类型占位符。 */
function toPlainData(v) {
	if (v === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(v));
	} catch {
		return `[unserializable: ${Object.prototype.toString.call(v)}]`;
	}
}
