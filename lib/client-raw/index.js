/**
 * Client half: the settings page that drives a scan and an apply.
 *
 * Layout follows the host's own settings cards (720px page, 12px section gap,
 * 10px field labels). No self-made RPC channel: every call goes through
 * `ctx.remote.piAiModality`, which the host half exposes as a
 * `TypertRemoteService` namespace.
 *
 * @module src/client/index
 */
import react from 'react';
const jsx = react.createElement;
// The one reusable component library a bundle may require. Buttons, inputs and
// pills come from here rather than from hand-written markup, so the page wears
// the host's own visual language instead of a lookalike.
const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives');
/**
 * One call to a host Remote method, over the gateway's HTTP surface.
 *
 * The gateway serves every `@Remote` method at `POST /api/<namespace>/<method>`
 * with a `client-request` envelope. Going through it directly costs the page
 * nothing that a generated proxy would have given it, and it works for a
 * namespace a third-party plugin owns — which the cordis-side `remote.*`
 * service does not, since nothing provisions those for plugin namespaces.
 */
let rpcSequence = 0;
async function callRemote(method, args) {
    const response = await fetch(`/api/piAiModality/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
            type: 'client-request',
            rpcId: `pi-patch-${Date.now().toString(36)}-${(rpcSequence += 1)}`,
            method: `piAiModality/${method}`,
            payload: { args },
        }),
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} from ${method}`);
    const envelope = await response.json();
    const result = envelope?.result;
    if (result?.ok !== true)
        throw new Error(result?.error?.message ?? `${method} was refused`);
    return result.value;
}
/**
 * The fetch-backed implementation the page is handed.
 *
 * The gateway validates `args` against the host method's declared parameter
 * names, so each call wraps its value as `{ request: ... }`; a bare object is
 * refused with "args fields do not match the descriptor".
 */
const remoteNamespace = {
    version: () => callRemote('version', {}),
    providers: () => callRemote('providers', {}),
    scan: request => callRemote('scan', { request }),
    apply: request => callRemote('apply', { request }),
};
// Only `slots`: the page reaches the host over the gateway's own HTTP surface
// (see `callRemote`), not through a `remote.*` cordis service. Declaring
// `remote.piAiModality` here made cordis hold the whole client entry waiting
// for a service nothing provisions for a third-party namespace, and the page
// never appeared at all.
export const inject = ['slots', 'locale'];
/** The plugin's id, also the settings-section entry id. */
const PLUGIN_ID = 'dsh-model-capability-alignment';
/**
 * The version this bundle was built from.
 *
 * `scripts/build-client.mjs` replaces the placeholder with the manifest's
 * version, so the page can render the number before any host call. The host's
 * `version` Remote overrides it once it answers — the manifest stays the
 * single source of truth, and a rebuilt copy self-corrects.
 */
const BUNDLED_VERSION = '0.0.0-build-placeholder';
/** Locale namespace; the host resolves `zh`/`en` against the user's language. */
const NS = PLUGIN_ID;
/**
 * Both dictionaries, keyed identically.
 *
 * `zh` is the baseline the host requires (its `LOCALE_IDS` are exactly
 * `['zh','en']`), and every key appears in both: a key missing from the
 * active language falls back to the other rather than rendering the raw key.
 */
const zh = {
    'nav': '模型能力对齐',
    'title': '模型能力对齐',
    'title.version': 'v{version}',
    'intro': 'pi-ai 的模型发现只读取 id、name 和两个容量，从不填写模型的输入模态与思考档位。本页把你保留的模型与各端点对比，只补写缺失的字段。',
    'scope.title': '要补的字段',
    'scope.hint': '只写条目尚未声明的字段；你手工写过的值保持不变。',
    'scope.input': '输入模态声明',
    'scope.reasoning': '思考档位',
    'scope.prune': '实测后剔除',
    'prune.warn': '注意：探测会对每个模型发起一次真实的对话请求，消耗该路由的额度。',
    'prune.hint': '按 DSH 实际发送的流式请求逐个探测；结论有效的保留，其余取消勾选并标注原因。探测不计入字段写入。',
    'prune.timeout': '单模型上限（秒）',
    'prune.concurrency': '并行量',
    'prune.budget': '总预算（秒）',
    'prune.prompt': '测试提示词',
    'prune.verdict.ok': '正常',
    'prune.verdict.timeout': '超时',
    'prune.verdict.invalid': '已下线',
    'prune.verdict.limited': '配额受限',
    'prune.verdict.needs-auth': '需登录',
    'prune.verdict.unusable': '无套餐',
    'prune.verdict.lane-auth': '渠道密钥失效',
    'prune.verdict.transport': '网关不可达',
    'prune.verdict.error': '请求出错',
    'prune.verdict.skipped': '预算内未测到',
    'prune.reason.answered': '模型有回复',
    'prune.reason.answered-induced': '模型按测试提示词回复',
    'prune.reason.answered-offword': '有回复但不是目标词（{detail}）',
    'prune.reason.answered-toolcall': '以工具调用回复',
    'prune.reason.no-answer-in-timeout': '{detail}内未产生任何输出',
    'prune.reason.transport': '连接失败，未收到 HTTP 状态（网关本身不可达）',
    'prune.reason.lane-auth': '渠道凭据被拒，未到达模型',
    'prune.reason.id-gone': '服务端报告该模型已不存在',
    'prune.reason.needs-login': '渠道需要（重新）登录',
    'prune.reason.gateway-refused': '网关拒绝（{detail}）',
    'prune.reason.quota': '配额或限流',
    'prune.reason.plan': '该渠道需要付费套餐',
    'prune.reason.http-error': '请求失败（{detail}）',
    'prune.reason.skipped-budget': '总预算耗尽，未探测到该模型',
    'prune.tag': '{verdict}：{reason}',
    'prune.latency': '· 往返 {ms}',
    'route.title': '选择路由',
    'route.hint': '只扫描并写入所选路由下的模型，其余路由不访问、不改动。',
    'route.none': '（还没有配置路由）',
    'scan': '扫描',
    'scan.busy': '扫描中…',
    'result.title': '扫描结果',
    'result.restored': '以下为上次的扫描结果（未重新探测）。要拿最新状态请重新扫描。',
    'result.file': '写入文件：{file}',
    'result.summary': '共 {total} 个模型，已选 {picked} 个',
    'result.gone': '其中 {n} 个模型上游已消失，列在最前面供你决定是否保留。',
    'withheld.withheld-vocabulary': '端点发布的思考档位 {detail} 不在 pi-ai 词表内，该字段不写入。',
    'result.error': '{route}：{message}',
    'option.gain': '+ {field} → [{values}]',
    'option.now': '现为 [{values}]',
    'option.absent': '未声明',
    'option.gone': '上游已消失',
    'option.withheld': '! {note}',
    'pick.all': '全选',
    'pick.none': '清空',
    'apply.some': '写入所选（{n}）',
    'apply.busy': '写入中…',
    'apply.note': '顺序按上游清单原样。清单内模型默认选中，取消勾选即从配置移除；清单外模型勾选即新增。写入前自动备份。',
    'apply.done': '已写入 {n} 处；备份：{file}',
    'apply.done.removed': '已写入 {n} 处，移除 {removed} 个模型；备份：{file}',
};
const en = {
    'nav': 'Model capability alignment',
    'title': 'Model capability alignment',
    'title.version': 'v{version}',
    'intro': "pi-ai discovery reads only id, name and the two capacities, so a model's input modalities and reasoning efforts are never filled in. This page compares the models you kept against each endpoint and writes what is missing.",
    'scope.title': 'What to fill',
    'scope.hint': 'Only fields an entry does not already declare are written; a value you set by hand is kept.',
    'scope.input': 'Input capabilities',
    'scope.reasoning': 'Reasoning efforts',
    'scope.prune': 'Test-then-prune',
    'prune.warn': "Heads-up: every probe is a real chat request and consumes the route's quota.",
    'prune.hint': 'Each model is swept with the streaming request DSH sends; a passing verdict keeps it, anything else is unticked with the reason shown. Probing never writes fields by itself.',
    'prune.timeout': 'Per-model timeout (s)',
    'prune.concurrency': 'Concurrency',
    'prune.budget': 'Overall budget (s)',
    'prune.prompt': 'Testing prompt',
    'prune.verdict.ok': 'ok',
    'prune.verdict.timeout': 'timeout',
    'prune.verdict.invalid': 'retired',
    'prune.verdict.limited': 'quota-limited',
    'prune.verdict.needs-auth': 'needs login',
    'prune.verdict.unusable': 'plan-gated',
    'prune.verdict.lane-auth': 'lane key rejected',
    'prune.verdict.transport': 'gateway unreachable',
    'prune.verdict.error': 'request failed',
    'prune.verdict.skipped': 'not reached in budget',
    'prune.reason.answered': 'model replied',
    'prune.reason.answered-induced': "replied with the prompt's target word",
    'prune.reason.answered-offword': 'replied, but not with the target word ({detail})',
    'prune.reason.answered-toolcall': 'answered via a tool call',
    'prune.reason.no-answer-in-timeout': 'no output within {detail}',
    'prune.reason.transport': 'connection failed before any HTTP status; the gateway itself was unreachable',
    'prune.reason.lane-auth': 'lane credential rejected before reaching the model',
    'prune.reason.id-gone': 'the provider reports this id no longer exists',
    'prune.reason.needs-login': 'the channel needs a (re)login',
    'prune.reason.gateway-refused': 'the gateway refused ({detail})',
    'prune.reason.quota': 'quota or rate limit',
    'prune.reason.plan': 'the channel requires a paid plan',
    'prune.reason.http-error': 'request failed ({detail})',
    'prune.reason.skipped-budget': 'the overall budget ran out before this model was probed',
    'prune.tag': '{verdict}: {reason}',
    'prune.latency': '· {ms} round trip',
    'route.title': 'Which route',
    'route.hint': 'Only the selected route is scanned and written; every other route is left untouched.',
    'route.none': '(no routes configured)',
    'scan': 'Scan',
    'scan.busy': 'Scanning…',
    'result.title': 'Result',
    'result.restored': 'Restored from your previous scan — not re-probed. Scan again for current state.',
    'result.file': 'writes to: {file}',
    'result.summary': '{total} models, {picked} selected',
    'result.gone': '{n} of them are no longer served upstream and lead the list so you can decide whether to keep them.',
    "withheld.withheld-vocabulary": "the endpoint publishes the level menu {detail}, which is not pi-ai's vocabulary; the field is withheld",
    'result.error': '{route}: {message}',
    'option.gain': '+ {field} → [{values}]',
    'option.now': 'now [{values}]',
    'option.absent': 'declares nothing',
    'option.gone': 'gone upstream',
    'option.withheld': '! {note}',
    'pick.all': 'Select all',
    'pick.none': 'Clear',
    'apply.some': 'Apply selected ({n})',
    'apply.busy': 'Writing…',
    'apply.note': "Order follows the upstream listing exactly. Profile models start ticked; unticking one removes it. A route extra is ticked to be added. A backup is taken before any write.",
    'apply.done': 'wrote {n} field(s); backup: {file}',
    'apply.done.removed': 'wrote {n} field(s), removed {removed} model(s); backup: {file}',
};
const CSS = `
.pi-patch{max-width:720px;display:flex;flex-direction:column;gap:28px;padding-bottom:28px}
.pi-patch h1{font-size:16px;font-weight:500;line-height:24px;margin:0}
.pi-patch h1 .version{font-size:11px;font-weight:400;margin-left:8px;color:var(--dsw-alias-label-tertiary)}
.pi-patch .intro{font-size:14px;line-height:22px;margin:8px 0 0;color:var(--dsw-alias-label-tertiary)}
.pi-patch section{display:flex;flex-direction:column;gap:12px}
.pi-patch .head h2{font-size:14px;font-weight:500;line-height:22px;margin:0}
.pi-patch .head p{font-size:12px;line-height:18px;margin:1px 0 0;color:var(--dsw-alias-label-tertiary)}
.pi-patch .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pi-patch label.check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px}
.pi-patch select{height:32px;border-radius:9px;padding:0 10px;font-size:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4)}
.pi-patch button{height:32px;border-radius:9px;padding:0 12px;font-size:12px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary)}
.pi-patch button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:none}
.pi-patch button:disabled{opacity:.4;cursor:default}
.pi-patch .note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}
.pi-patch .error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);margin:0}
.pi-patch .ok{font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary);margin:0}
.pi-patch .list{display:flex;flex-direction:column;gap:6px}
.pi-patch .item{border:.5px solid var(--dsw-alias-border-l4);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.pi-patch .item .name{font-size:12px;line-height:18px;font-family:var(--ds-font-family-code)}
.pi-patch .item .facts{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.pi-patch .item .gain{font-size:11px;line-height:16px;color:var(--dsw-alias-state-success-primary)}
.pi-patch .item .warn{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-label)}
.pi-patch .item .rowLine{display:flex;align-items:center;gap:8px}
.pi-patch .item .tag{font-size:10px;line-height:16px;padding:0 6px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);flex:none}
.pi-patch .item .tag.gone{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-label)}
`;
/** Inject the stylesheet once, keyed by this module. */
function ensureStyles() {
    if (typeof document === 'undefined')
        return;
    const id = 'dsh-model-capability-alignment/styles';
    if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null)
        return;
    const tag = document.createElement('style');
    tag.dataset.pluginCss = id;
    tag.textContent = CSS;
    document.head.appendChild(tag);
}
/**
 * Render one model row.
 *
 * Three states, told apart at a glance because the user asked to see which
 * entries already carried these fields before anything was written:
 *
 * - **already declared** — the profile has a value; nothing is offered for it.
 * - **to fill** — a checkbox and the value the endpoint publishes.
 * - **not in your list** — the route serves it, the profile does not keep it.
 *   Shown without a checkbox: ticking it would have to add the model to the
 *   profile, and a model removed on purpose stays removed.
 */
function ModelRow({ model, checked, onToggle, t }) {
    const gone = model.listed === false;
    const gains = model.patches.map(patch => t('option.gain', { field: patch.field, values: patch.value.join(', ') }));
    const declared = model.current.input !== undefined
        ? t('option.now', { values: model.current.input.join(', ') })
        : model.endpoint?.input !== undefined
            ? t('option.now', { values: model.endpoint.input.join(', ') })
            : t('option.absent');
    // Every row is the same row. The only decorations are the two facts a user
    // cannot read off the id: the model is gone from the listing (a tag), and
    // what the probe said about it (a reason). Which side of the profile it
    // sits on changes nothing else — no "already set" badge, no "add me"
    // invitation; the default tick carries that meaning and one click undoes it.
    // A profile row is always actionable: tick = keep / fix, untick = remove.
    // A route extra is actionable when there is something to write for it (a
    // declared field, or a passing probe that justifies a baseline entry).
    const writable = model.origin !== 'endpoint'
        || model.patches.length > 0
        || model.endpoint?.input !== undefined
        || model.prune?.verdict === 'ok';
    return jsx('div', { className: 'item', key: model.id }, [
        jsx('label', { className: 'check', key: 'box' }, [
            jsx('input', {
                key: 'input', type: 'checkbox', checked, disabled: !writable,
                onChange: () => onToggle(model.id),
            }),
            jsx('span', { className: 'name', key: 'name' }, model.id),
            ...gone ? [jsx('span', { className: 'tag gone', key: 'gone' }, t('option.gone'))] : [],
        ]),
        jsx('div', { className: 'facts', key: 'facts' }, declared),
        model.prune === undefined ? null : jsx('div', { className: `pruneTag ${model.prune.verdict}`, key: 'prune' }, [
            t('prune.tag', {
                verdict: t(`prune.verdict.${model.prune.verdict}`),
                reason: t(`prune.reason.${model.prune.reason.key}`, model.prune.reason.detail === undefined ? undefined : { detail: model.prune.reason.detail }),
            }),
            // The measured round trip, as recorded by that probe — no re-measuring.
            // Only a passing verdict has a meaningful number to show: a failed one
            // spent its budget waiting, which the verdict already says.
            ...(model.prune.verdict === 'ok' && typeof model.prune.ms === 'number'
                ? [jsx('span', { className: 'latency', key: 'ms' }, t('prune.latency', {
                        ms: model.prune.ms >= 1000 ? `${(model.prune.ms / 1000).toFixed(1)}s` : `${model.prune.ms}ms`,
                    }))]
                : []),
        ]),
        ...gains.map((gain, index) => jsx('div', { className: 'gain', key: `g${index}` }, gain)),
        ...model.withheld.map((note, index) => jsx('div', { className: 'warn', key: `w${index}` }, t('option.withheld', { note: t(`withheld.${note.key}`, note.detail === undefined ? undefined : { detail: note.detail }) }))),
    ]);
}
const SNAPSHOT_KEY = 'dsh-model-capability-alignment/session';
/** What the page keeps across a dismissal, or `undefined` on a cold mount. */
function readSnapshot() {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_KEY);
        return raw === null ? undefined : JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
/** Persist the parts worth surviving; failures never break the page. */
function writeSnapshot(value) {
    try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(value));
    }
    catch {
        /* storage disabled or full: the page still works, just forgetful */
    }
}
/**
 * The settings page.
 *
 * Flow: pick a route → scan it → review → apply. The route dropdown comes
 * BEFORE the scan because a profile can hold ten gateways and the user asked
 * for one: scanning all of them wastes a round trip to every route, reports
 * errors for routes nobody cares about, and — the bug this ordering buries —
 * an unticked "Apply all" used to write every route in the profile because
 * nothing bounded it. `selected` now flows into both `scan` and `apply` as
 * `providers: [selected]`.
 */
export function SettingsPage(props) {
    ensureStyles();
    const { remote, t } = props;
    const [restored] = react.useState(() => readSnapshot());
    const [providers, setProviders] = react.useState(restored?.providers ?? null);
    // Start from the version baked into this bundle, then let the host correct
    // it: the bundle answers instantly (no round trip before the title), and the
    // manifest stays the single source of truth when its answer arrives.
    const [version, setVersion] = react.useState(BUNDLED_VERSION);
    const [selected, setSelected] = react.useState(restored?.selected ?? '');
    const [scope, setScope] = react.useState({ input: true, reasoningEfforts: true });
    // The prune checkbox is a third option on the same row; its knobs render on
    // an indented row BELOW the options, only while it is ticked.
    const [prune, setPrune] = react.useState(restored?.prune ?? false);
    const [timeoutS, setTimeoutS] = react.useState(restored?.timeoutS ?? 30);
    const [concurrency, setConcurrency] = react.useState(restored?.concurrency ?? 4);
    const [budgetS, setBudgetS] = react.useState(restored?.budgetS ?? 600);
    // The induced-word prompt: its last word is what the reply is checked for.
    const [prompt, setPrompt] = react.useState(restored?.prompt ?? 'just reply ok');
    const [scan, setScan] = react.useState(restored?.scan ?? null);
    const [scanAt, setScanAt] = react.useState(restored?.scanAt ?? '');
    const [picked, setPicked] = react.useState(new Set(restored?.picked ?? []));
    const [busy, setBusy] = react.useState(false);
    const [error, setError] = react.useState('');
    const [done, setDone] = react.useState('');
    // Keep the snapshot in step with the page: whatever the user was looking at
    // when they clicked the dimmed area is what they find on their return.
    const busyRef = react.useRef(busy);
    busyRef.current = busy;
    react.useEffect(() => {
        if (busyRef.current)
            return;
        writeSnapshot({
            providers, selected, scan, picked: [...picked], version, prune, scanAt,
            timeoutS, concurrency, budgetS, prompt,
        });
    }, [providers, selected, scan, picked, version, prune, scanAt, timeoutS, concurrency, budgetS, prompt]);
    react.useEffect(() => {
        let live = true;
        remote.version()
            .then(row => { if (live)
            setVersion(row.version); })
            .catch(() => { });
        return () => { live = false; };
    }, [remote]);
    react.useEffect(() => {
        let live = true;
        remote.providers()
            .then(rows => {
            if (!live)
                return;
            setProviders(rows);
            // Default the dropdown so the first scan has a route even if the user
            // never touches the select; an empty string means "all routes".
            setSelected(prev => prev !== '' || rows.length === 0 ? prev : rows[0].id);
        })
            .catch((cause) => { if (live)
            setError(cause instanceof Error ? cause.message : String(cause)); });
        return () => { live = false; };
    }, [remote]);
    // Switching routes invalidates any previous scan: its numbers describe the
    // other route's endpoint.
    const chooseRoute = (id) => { setSelected(id); setScan(null); setPicked(new Set()); setDone(''); setError(''); };
    const provider = scan?.providers.find(row => row.id === selected) ?? null;
    // Every model the route reports is listed — the profile's own first, then
    // One flat list in the order the scan returned it: models that vanished
    // upstream first, then the endpoint's own listing order. No regrouping, no
    // special case for a model just because the profile already keeps it.
    const listed = provider?.models ?? [];
    const goneCount = listed.filter(model => model.listed === false).length;
    const writable = (model) => model.origin !== 'endpoint'
        || model.patches.length > 0
        || model.endpoint?.input !== undefined
        || model.prune?.verdict === 'ok';
    const selectable = listed.filter(writable);
    const runScan = async () => {
        setBusy(true);
        setError('');
        setDone('');
        setScan(null);
        setPicked(new Set());
        try {
            const result = await remote.scan({
                ...scope,
                ...(prune === false ? {} : {
                    prune: {
                        modelTimeoutMs: timeoutS * 1000,
                        concurrency,
                        budgetMs: budgetS * 1000,
                        ...prompt.trim() === '' ? {} : { prompt: prompt.trim() },
                    },
                }),
                ...selected === '' ? {} : { providers: [selected] },
            });
            setScan(result);
            setScanAt(new Date().toISOString());
            // Default: every profile row is ticked (keep / fix); a failed probe
            // removes that tick, which is what makes an unticked profile row a
            // deletion. A route extra ticks only when the probe proved it alive.
            setPicked(new Set(result.providers
                .flatMap(row2 => row2.models)
                .filter(model => model.origin !== 'endpoint'
                ? (model.prune === undefined || model.prune.verdict === 'ok')
                : model.prune?.verdict === 'ok')
                .map(model => model.id)));
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const toggle = (id) => {
        setPicked(prev => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    };
    const runApply = async () => {
        if (provider === null)
            return;
        setBusy(true);
        setError('');
        setDone('');
        try {
            // The one rule: a ticked profile row stays (and gains its patches), an
            // unticked profile row goes. Route extras that are ticked are adopted;
            // ones left unticked are simply not added.
            const drops = listed
                .filter(model => model.origin !== 'endpoint' && !picked.has(model.id))
                .map(model => ({ model: model.id, field: 'input', value: [], remove: true }));
            const fields = listed
                .filter(model => picked.has(model.id)
                && (model.prune === undefined || model.prune.verdict === 'ok'))
                .flatMap(model => {
                if (model.patches.length > 0)
                    return model.patches.map(patch => ({ ...patch, model: model.id }));
                // A ticked row with no planned field: for a route extra this is the
                // adopt itself (a minimal entry), for a profile row there is nothing
                // to change — keeping it needs no write.
                if (model.origin !== 'endpoint')
                    return [];
                const input = model.endpoint?.input;
                if (input === undefined && model.prune?.verdict !== 'ok')
                    return [];
                return [{ model: model.id, field: 'input', value: input ?? ['text'], adopt: true }];
            });
            const all = [...drops, ...fields];
            if (all.length === 0)
                return;
            const result = await remote.apply({
                ...scope,
                providers: [provider.id],
                models: all.map(field => `${provider.id}/${field.model}`),
                fields: all,
                // The reviewed row order, so the file ends up in it rather than in
                // whatever order appends and deletions happened to leave behind.
                orderIds: { [provider.id]: listed.map(model => model.id) },
            });
            setDone(drops.length === 0
                ? t('apply.done', { n: result.written, file: result.backup })
                : t('apply.done.removed', { n: result.written - drops.length, removed: drops.length, file: result.backup }));
            setScan(null);
            setPicked(new Set());
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    /** The select-all / clear / apply row, shared by the top and the bottom. */
    const actionRow = (key) => [jsx('div', { className: 'row', key }, [
            jsx(Button, { key: 'all', onClick: () => setPicked(new Set(selectable.map(model => model.id))) }, t('pick.all')),
            jsx(Button, { key: 'none', onClick: () => setPicked(new Set()) }, t('pick.none')),
            jsx(Button, { key: 'apply', variant: 'primary', disabled: busy || listed.length === 0, onClick: runApply }, busy ? t('apply.busy') : t('apply.some', { n: picked.size })),
        ])];
    const routeOptions = providers ?? [];
    return jsx('div', { className: 'pi-patch' }, [
        jsx('div', { key: 'head' }, [
            jsx('h1', { key: 'h1' }, [
                t('title'),
                version === '' ? null : jsx('span', { className: 'version', key: 'v' }, t('title.version', { version })),
            ]),
            jsx('p', { className: 'intro', key: 'p' }, t('intro')),
        ]),
        jsx('section', { key: 'route' }, [
            jsx('div', { className: 'head', key: 'h' }, [
                jsx('h2', { key: 'h2' }, t('route.title')),
                jsx('p', { key: 'p' }, t('route.hint')),
            ]),
            jsx('div', { className: 'row', key: 'r' }, [
                jsx('select', {
                    key: 'sel', value: selected, 'aria-label': t('route.title'),
                    onChange: (event) => chooseRoute(event.target.value),
                }, routeOptions.length === 0
                    ? [jsx('option', { key: 'none', value: '' }, t('route.none'))]
                    : routeOptions.map(row => jsx('option', { key: row.id, value: row.id }, `${row.id} (${row.modelCount})`))),
            ]),
        ]),
        jsx('section', { key: 'scope' }, [
            jsx('div', { className: 'head', key: 'h' }, [
                jsx('h2', { key: 'h2' }, t('scope.title')),
                jsx('p', { key: 'p' }, t('scope.hint')),
            ]),
            // Options stay on one row; the Scan button lives on its own line below,
            // so more option checkboxes can join this row without dragging the
            // action along or wrapping unpredictably. A ticked option's own knobs
            // render on an indented row beneath the options row.
            jsx('div', { className: 'row', key: 'r' }, [
                jsx('label', { className: 'check', key: 'i' }, [
                    jsx('input', { key: 'c', type: 'checkbox', checked: scope.input, onChange: () => setScope(prev => ({ ...prev, input: !prev.input })) }),
                    jsx('span', { key: 't' }, t('scope.input')),
                ]),
                jsx('label', { className: 'check', key: 'r2' }, [
                    jsx('input', { key: 'c', type: 'checkbox', checked: scope.reasoningEfforts, onChange: () => setScope(prev => ({ ...prev, reasoningEfforts: !prev.reasoningEfforts })) }),
                    jsx('span', { key: 't' }, t('scope.reasoning')),
                ]),
                jsx('label', { className: 'check', key: 'p' }, [
                    jsx('input', { key: 'c', type: 'checkbox', checked: prune, onChange: () => setPrune(prev => !prev) }),
                    jsx('span', { key: 't' }, t('scope.prune')),
                ]),
            ]),
            prune === false ? null : jsx('div', { className: 'row indent', key: 'pruneOpts' }, [
                jsx('label', { className: 'knob', key: 'to' }, [
                    `${t('prune.timeout')} `,
                    jsx('input', {
                        key: 'in', type: 'number', min: 1, max: 600, value: timeoutS,
                        onChange: (event) => setTimeoutS(Number(event.target.value) || 90),
                    }),
                ]),
                jsx('label', { className: 'knob', key: 'cc' }, [
                    `${t('prune.concurrency')} `,
                    jsx('input', {
                        key: 'in', type: 'number', min: 1, max: 16, value: concurrency,
                        onChange: (event) => setConcurrency(Number(event.target.value) || 4),
                    }),
                ]),
                jsx('label', { className: 'knob', key: 'bd' }, [
                    `${t('prune.budget')} `,
                    jsx('input', {
                        key: 'in', type: 'number', min: 10, max: 3600, value: budgetS,
                        onChange: (event) => setBudgetS(Number(event.target.value) || 600),
                    }),
                ]),
                jsx('label', { className: 'knob', key: 'pt' }, [
                    `${t('prune.prompt')} `,
                    jsx('input', {
                        key: 'in', type: 'text', value: prompt, style: { width: '140px' },
                        onChange: (event) => setPrompt(event.target.value),
                    }),
                ]),
            ]),
            prune === false ? null : jsx('p', { className: 'note indent', key: 'pruneHint' }, t('prune.hint')),
            prune === false ? null : jsx('p', { className: 'warn indent', key: 'pruneWarn' }, t('prune.warn')),
            jsx('div', { className: 'row', key: 'actions' }, [
                jsx(Button, {
                    key: 'b', variant: 'primary',
                    disabled: busy || (!scope.input && !scope.reasoningEfforts && !prune) || selected === '',
                    onClick: runScan,
                }, busy ? t('scan.busy') : t('scan')),
            ]),
        ]),
        error === '' ? null : jsx('p', { key: 'err', className: 'error' }, error),
        done === '' ? null : jsx('p', { key: 'done', className: 'ok' }, done),
        scan === null ? null : jsx('section', { key: 'result' }, [
            jsx('div', { className: 'head', key: 'h' }, [
                jsx('h2', { key: 'h2' }, t('result.title')),
                ...scan === restored?.scan && restored?.scan != null
                    ? [jsx('p', { key: 'restored', className: 'note' }, t('result.restored'))]
                    : [],
                jsx('p', { key: 'p' }, t('result.file', { file: scan.file })),
                jsx('p', { key: 'sum' }, t('result.summary', { total: listed.length, picked: picked.size })),
                ...goneCount === 0 ? [] : [jsx('p', { key: 'gone', className: 'note' }, t('result.gone', { n: goneCount }))],
            ]),
            ...actionRow('pick'),
            provider?.error === undefined ? null : jsx('p', { key: 'perr', className: 'error' }, t('result.error', { route: provider.id, message: provider.error })),
            jsx('p', { className: 'note', key: 'note' }, t('apply.note')),
            jsx('div', { className: 'list', key: 'list' }, listed.map(model => jsx(ModelRow, { key: model.id, model, checked: picked.has(model.id), onToggle: toggle, t }))),
            // The same action row below the list: a long route ends at the bottom,
            // and scrolling back up to write is exactly the trip this saves.
            ...actionRow('pick-bottom'),
        ]),
    ]);
}
/**
 * Register the settings page.
 *
 * `settings.section` is what puts an entry in the settings navigation beside
 * "General" and "Models" — the navigation list is literally
 * `ctx.slots.entries("settings.section")` mapped over `{id, order, label}`.
 * A keyed `settings.plugin.item` card was the first attempt and the wrong
 * shape here: it buries the tool inside the Plugins tab, and pairing that slot
 * needs a settings namespace this plugin deliberately does not register (it
 * has no user configuration of its own).
 *
 * `order: 12` sits just after Models (10): the page is about model metadata.
 */
export function apply(ctx) {
    const host = ctx;
    if (host.slots === undefined)
        return;
    const slots = host.slots;
    // Registering the dictionaries and binding `t` once here is what makes the
    // page follow the host's language: `bind` answers with a live translator
    // (it resolves against the active locale on every call), and the settings
    // navigation re-reads `label` whenever the locale revision changes — so
    // `label: () => t('nav')` switches without a reload. Without a locale
    // service the page still renders, from the English dictionary.
    const t = host.locale === undefined
        ? (key, params) => interpolate(en[key] ?? zh[key] ?? key, params)
        : (host.locale.register(NS, { zh, en }), host.locale.bind(NS));
    slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: PLUGIN_ID,
        order: 12,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ remote: remoteNamespace, t }),
    }, SettingsPage));
}
/** Fill `{placeholders}` in a template; a missing parameter leaves it alone. */
function interpolate(template, params) {
    if (params === undefined)
        return template;
    return template.replace(/\{(\w+)\}/g, (whole, name) => Object.hasOwn(params, name) ? String(params[name]) : whole);
}
