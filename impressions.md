# Experimental impressions and next leads

These are working observations and hypotheses from manual LLM Parcours runs. They are not claims about provider internals.

## 2026-09-12 — Static vs recursive fresh-link transport

In normal ChatGPT web browsing with GPT-5.6 Sol, the Static Binary Channel produced persistent state for the first distinct fixed ZERO and ONE targets, but attempts to reuse those same concrete targets appeared to be reused or deduplicated by the browsing layer. A run intended to transmit `01010101` reached authoritative server state `01`.

A prompt-level URL-template experiment showed a different boundary: the model correctly understood how to substitute successive suffixes, but navigation to the resulting model-constructed URLs was rejected. This separates conceptual URL construction from actual navigation actuation.

The Circular Trail then supplied a fresh concrete ZERO, ONE, and READ link from each preceding server response. Two especially useful runs succeeded end-to-end:

- `01010101` -> authoritative length 8, next trail step 8.
- `00000` -> authoritative length 5, next trail step 5.

The `00000` result is an important control: repeated instances of the same logical action work when each instance is represented by a fresh server-issued concrete URL. This makes it less plausible that the earlier Static result reflected a one-use limit on the logical ZERO or ONE operation itself.

Current observational distinction:

1. Exact fixed user-supplied target: initial navigation can actuate state; repeated identical-target navigation may be reused/deduplicated.
2. Fresh model-constructed target: the model may understand the construction rule while navigation still fails a provenance/safety gate.
3. Fresh server-discovered target: recursive navigation can succeed across multiple steps, including repeated identical logical actions.

Treat these as behavior of the tested deployed environment, not inferred implementation architecture.

## Next lead — N-ary / bundled-symbol Trail

The current Circular Trail transmits one bit per write action because every step offers two logical write choices:

- ZERO -> `0`
- ONE -> `1`

If the dominant cost is a serial browser/tool round trip, more information can be carried per successful action by increasing the number of server-issued choices. A four-way step could offer:

- `00`
- `01`
- `10`
- `11`

One successful navigation would then encode 2 bits rather than 1. More generally, an N-way choice carries `log2(N)` bits when N is a power of two.

Candidate widths:

| Choices per step | Bits per successful action |
| ---: | ---: |
| 2 | 1 |
| 4 | 2 |
| 8 | 3 |
| 16 | 4 |
| 32 | 5 |
| 256 | 8 |

For a 32-bit payload, the ideal write-hop count is `ceil(32 / log2(N))`: 32 binary hops, 16 quaternary hops, 8 sixteen-way hops, and 4 256-way hops.

This suggests a distinct **N-ary Trail** station. It should preserve the successful Circular Trail provenance mechanism: every choice is a complete ordinary `<a href>` returned by the immediately previous server response, and the tested model never constructs or modifies the destination URL.

The experimental question is not merely whether wider alphabets work. Measure both:

- correctness / successful persistent state;
- useful payload bits per successful web action.

Increasing N may eventually expose a different bottleneck: link perception, page extraction/truncation, choice selection, tool representation limits, or model error. Testing the same fixed payload across N = 2, 4, 8, 16, 32, ... would therefore estimate the useful bandwidth of the deployed environment's native link-selection channel rather than only its maximum recursive depth.

Keep this separate from the Alias condition. The key variable should be branching width while URL provenance remains server-issued and recursive.

## Loom Agent Keyboard implication to test

The Parcours results raise a concrete alternative explanation for the earlier Loom Agent Keyboard failure.

The keyboard design asked the model to select a character and then derive/append that character into a URL. Parcours now shows that, in at least one normal ChatGPT browsing environment, understanding such a URL transformation does not imply permission or ability to navigate to the model-constructed result. Meanwhile, fresh complete links discovered in the immediately preceding server response can support recursive state-changing interaction.

Therefore the keyboard may have failed at **URL construction/provenance**, not at character selection or recursive interaction.

A clean follow-up should not ask the model to append a letter to any URL. Instead, each keyboard page should render complete server-issued links for every available key, for example:

```html
<a href="...opaque-fresh-target-for-a...">a</a>
<a href="...opaque-fresh-target-for-b...">b</a>
<a href="...opaque-fresh-target-for-c...">c</a>
...
<a href="...opaque-fresh-target-for-done...">done</a>
```

After a key is selected, the response should persist the character and render a fresh complete set of key links for the next step. `done` should return a server-issued READ link. The visible key label may carry semantic meaning; the URL itself should remain opaque and require no construction by the model.

This would test whether the original Agent Keyboard's apparent limitation disappears when URL derivation is removed while the intended keyboard interaction remains otherwise equivalent.
