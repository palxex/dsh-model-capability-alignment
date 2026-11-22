# dsh-model-capability-alignment

English | [中文](README.zh.md)

Fill in the two model capabilities that pi-ai's discovery deliberately never
writes, for the models you actually keep.

## The gap this closes

`@deepseek-ai/dsh-llm-pi-ai` lists a gateway's models by reading its
`GET {baseURL}/models` reply. `readListing` publishes **id, name, contextWindow
and maxTokens** — and nothing else, because:

> Nothing can interrogate a gateway for its modalities — no OpenAI-compatible
> listing endpoint reports them — so the only honest floor is the modality
> every supported protocol certainly carries.

That reasoning is sound, and the decision is recorded in the upstream note
`2026-08-12-pi-ai-route-default-input-modalities`. The consequence is that two
fields which *do* exist in the config schema and *are* honoured at runtime are
never filled in by anybody:

| Field | What it decides | Runtime effect |
|---|---|---|
| `input` | `["text"]` or `["text","image"]` | Three admission points refuse an image for a model that omits it: model selection, prompt admission, and `read_image`. |
| `reasoningEfforts` | the level menu, or `false` | Whether the picker offers thinking levels at all. |

A vision model on a custom OpenAI-compatible route is therefore announced
text-only, and you cannot attach an image to it.

## What this plugin does

It reads the same listing the adapter declines to parse, compares it against
**the models your profile keeps**, and writes only the fields that are missing.

**It works for every provider in your `llm-pi-ai` config, not one vendor.**
The page lists every route; pick any of them. All three protocols pi-ai speaks
are handled — `openai-completions`, `openai-responses` at `{baseURL}/models`,
and `anthropic-messages` at `{root}/v1/models` — and each route authenticates
the way its protocol expects (`Authorization: Bearer`, or `x-api-key` +
`anthropic-version`), with the key resolved from the host's credential store by
the reference the profile names in `apiKeyEnv`. A keyless gateway (Ollama, LM
Studio, a local OpenAI-compatible server) is scanned without one.

Nothing is assumed to be vendor-specific: the reader accepts the modality and
effort spellings any gateway may publish (`input`, `input_modalities`,
`modalities.input`, `architecture.input_modalities`; `reasoning_efforts`,
`efforts`, or any `*efforts` string list, plus `reasoning_options`).

- **Everything the route serves is listed; only your models are written.** The
  endpoint is the authority on capabilities, never on membership. Off-list
  models appear so the listing is complete — a route serving a model your
  config never mentioned is worth seeing — but they carry no checkbox, because
  writing one would add the model back to the profile. A model you removed is
  removed on purpose.
- **Only the fields that are absent.** A value you wrote by hand is left alone.
- **A backup first.** Every apply writes `cordis.patch.yml.bak-<stamp>` beside
  the original, and the edit is verified by re-parsing the rendered text before
  it replaces anything.
- **Comments survive.** The profile patch is a hand-written file; the edit goes
  through the `yaml` Document API so an edit that changes three lines writes
  exactly three lines.

## Which file it writes

`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`, under the `llm-pi-ai` entry's
`config.providers.<route>.models[]`. It never uses `modelOverrides`: pi-ai
refuses an override beside a models list outright
(`models already replaces the served catalog, so declare the fields on its
entries`).

The plugin **edits an existing patch and never creates one**. If the file is
absent it says so and stops.

## Using it

Settings → **Model capability alignment**.

1. **Pick a route.** The dropdown lists every provider in your `llm-pi-ai`
   config with how many models it keeps. Only the selected route is scanned and
   written; the others are neither contacted nor touched.
2. Tick the fields you want filled (`input`, `reasoningEfforts`, or both).
3. **Scan** — read-only; nothing is written.
4. Review what each kept model would gain, and untick anything you do not want.
   The summary splits the route into four states — **to fill**, **already set**
   (your entry declares the field, nothing is offered), **endpoint silent** (the
   route listed the model but published no modality for it) and **not in your
   list** (shown, never written). A row is tagged "already set" only when the
   entry really declares a value: a model with nothing to write because the
   endpoint said nothing is not one that already declared it.
5. **Apply** — a timestamped backup is taken, then the file is rewritten.

The page follows the host's language (`zh` / `en`).

## Why the apply always names its models

`providers` bounds the write on a host that reads it, but a running host is not
restarted to pick up a plugin edit, and an older one ignores `providers`
entirely — leaving it with no model list would put it back to writing every
route in the profile. The page therefore always sends the explicit model list,
which bounds the write on both generations.

`reasoningEfforts` is reported but **withheld** when the endpoint publishes a
vocabulary pi-ai's schema does not accept (`light`/`extra_high` rather than
`low`/`high`/`max`): writing a foreign level name would make the entry
invalid, so the page shows the menu and explains why it is not written.

## Developing it

Host code hot-reloads, but only when the reload is nudged: the harness's HMR
compares every loaded profile module against disk **when a profile patch or
manifest changes** — it does not watch `node_modules` (the watcher's ignored
list excludes it by default). After editing host code and copying `lib/` into
the profile, `touch ~/.dsh/profiles/web/cordis.patch.yml` to trigger a
reconciliation: stale modules are replaced in place, fibers restarted, no
host restart needed. Client code (`lib/client.js`) needs no nudge at all — it
is served from disk per request with a content-derived rev.

## Limits

- It cannot make `discovery` fill these fields — nothing can, by upstream
  design. It writes them where the adapter already reads them.
- A wrong `input` is expensive: an image admitted for a provider that rejects
  it is committed to the session log before the request is built. The page
  therefore never guesses — only an endpoint declaration is written.
- `compat` (including `maxTokensField`) is deliberately out of scope: pi-ai
  selects a protocol default, and a wrong switch breaks every request.

## License

MIT
