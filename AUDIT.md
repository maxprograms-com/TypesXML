# RelaxNG Support — Code Audit

Date: 2026-11-04
Scope: RelaxNG implementation in the working tree (uncommitted): `ts/RelaxNGParser.ts`, `ts/relaxng/` (patterns, builder, validator, restrictions, datatypes), `ts/grammar/RelaxNGGrammar.ts`, `ts/tests/RelaxNGTestSuite.ts`, plus the SAXParser integration points (`xml-model` handling, default-attribute merging, grammar caching).
References: RELAX NG Specification (OASIS Committee Specification, 3 December 2001) and RELAX NG DTD Compatibility (compatibility-20011203).

## Verdict

The implementation is a faithful realization of the RELAX NG derivative-based validation algorithm and passes the official James Clark test suite at 100% (965/965 checks). The core semantics are correct. Five genuine spec-conformance bugs were found and reproduced, all in schema *simplification/strictness* areas, plus a handful of minor issues. None of the bugs affect validation correctness for mainstream schemas; they mostly cause incorrect schemas to be accepted, or valid-but-unusual schemas to be rejected.

Test-suite status (all suites run during this audit):

| Suite | Result |
|---|---|
| RelaxNG (`npm run testRelaxNG`) | 965/965 (100.0%), 0 failed, 0 skipped |
| DTD (`npm run testDtd`) | 0 invalid files missed |
| XML Schema (`npm run testXmlSchema`) | 37905/39191 (96.7%, as documented) |
| JSON (`npm run testJson`) | passed |

## Confirmed bugs

### 1. Missing prohibited-path checks for `ref` (spec 7.1.1, 7.1.3, 7.1.4) — Medium

The spec prohibits `ref` descendants outright in three places, regardless of what the ref resolves to:

- `attribute//ref` (7.1.1)
- `list//ref` (7.1.3)
- `data/except//ref` (7.1.4)

`ts/relaxng/RelaxNGRestrictions.ts` dereferences `RefPattern` (`target()`) and checks the *resolved* pattern against the flags, so a ref that resolves to an allowed pattern is accepted. Reproduced: the following are all **accepted** but must be rejected:

```xml
<attribute name="bar"><ref name="x"/></attribute>   <!-- x = <data type="string"/> -->
<list><ref name="x"/></list>                        <!-- x = <data type="string"/> -->
<data type="string"><except><ref name="x"/></except></data>  <!-- x = <value>bad</value> -->
```

Note the sibling checks work: `attribute//attribute`, `list//text`, `list//list`, `data/except//empty`, etc. are all correctly rejected via the `IN_ATTRIBUTE`/`IN_LIST`/`IN_DATA_EXCEPT` flags — only the bare-`ref` paths are missed. The bundled test suite has no `ref`-based cases for these sections, which is why 100% pass hides the gap. Validation semantics of accepted schemas are unaffected (dereferencing is semantically transparent), so this is a strictness/conformance issue, not a soundness one.

### 2. `include` element: `ns`/`datatypeLibrary` not inherited by overriding children (spec 4.7) — Medium

Spec 4.7 transforms `include` into a `div` carrying *all of the include's attributes except `href`*; both the included grammar's components and the include's own `start`/`define` children then inherit `ns` and `datatypeLibrary` through that div.

`ts/RelaxNGParser.ts` `replaceIncludes()` creates the div with **no attributes** and only calls `inheritAttribute(child, included, "ns")` (include's `ns` → included grammar root). Consequences, both reproduced live:

- `<include href="inc.rng" ns="http://example.com"><start><element name="foo">…` — the overriding start's `foo` should be in namespace `http://example.com`. The implementation instead matches a *no-namespace* `foo` and rejects the namespaced one.
- `<include href="inc2.rng" datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes"><define name="x"><data type="int"/>…` — fails to load with `Unknown built-in RelaxNG datatype "int"` because `datatypeLibrary` is dropped (for the overrides *and* the included components).

### 3. Foreign-element detection compares prefixes, not namespace URIs (spec 4.1) — Medium

`ts/RelaxNGParser.ts` `isRelaxNGElement()` decides foreign-ness by comparing an element's namespace *prefix* against the root element's prefix (`defaultPrefix`). Per spec, an element is foreign iff its namespace *URI* is not the RELAX NG namespace. A schema that binds the RNG namespace both to a prefix and as the default namespace, and mixes the two spellings, is valid per spec but breaks here — reproduced with both directions:

```xml
<rng:grammar xmlns:rng="http://relaxng.org/ns/structure/1.0" xmlns="http://relaxng.org/ns/structure/1.0">
  <start>…</start>   <!-- silently removed as "foreign" → "RelaxNG grammar has no start element" -->
</rng:grammar>
```

The same failure occurs for a prefixed `rng:start` inside an unprefixed `grammar`. Ironically `RelaxNGSyntax.validate()` is fully namespace-aware and passes these schemas; `removeForeign()` then mangles them.

### 4. `name` element: prefix must override an existing `ns` attribute (spec 4.10) — Low

Spec 4.10: "For any `name` element containing a prefix, the prefix is removed and an `ns` attribute is added **replacing any existing `ns` attribute**." `ts/RelaxNGParser.ts` `nameAttribute()` only adds `ns` when the element has none (`!ownNsAttr`), so `<name ns="http://example.com/wrong">p:bar</name>` uses `http://example.com/wrong` instead of the URI bound to `p`. Reproduced live. Contradictory `ns`+prefix combinations are rare in practice, hence Low.

### 5. `defaultValue` annotation matched by local name only — Low

`ts/RelaxNGParser.ts` `findDefaultValue()` / `isCompatibilityAnnotation()` accept any attribute/element whose *local name* is `defaultValue`, in any namespace (or none). `ts/relaxng/PatternBuilder.ts` `defaultValueOf()` does it correctly (prefix must resolve to `http://relaxng.org/ns/compatibility/annotations/1.0`). Net effect: a foreign `x:defaultValue="v"` (or unprefixed `defaultValue`) is harvested into the default-attributes map and merged into instances by the SAX parser, but is invisible to the compatibility checks in `RelaxNGDefaultValues` — inconsistent treatment of the same annotation.

## Minor issues and observations

1. **`RelaxNGValidator.isComplete()` is dead code** (`ts/relaxng/RelaxNGValidator.ts:136`). Never called by `RelaxNGGrammar` or anything else. Verified that incomplete root content *is* still rejected (the root's `endTagDeriv` returns `notAllowed`), so this is harmless — but either wire it into `endDocument()` as a belt-and-braces final check or remove it.

2. **Latent self-looping `RefPattern`s.** With loop detection disabled during the definitions pass (`PatternBuilder.buildGrammar`), an *unreachable* self-recursive define (`<define name="x"><ref name="x"/></define>`) produces a `RefPattern` whose `target` is itself. Verified: accepted without hanging, which matches spec 4.19 (unreachable defines are removed before loop checks). But any future code path that dereferences it (`PatternPool.deref`, `RelaxNGRestrictions.target`) would spin forever — a defensive cycle guard in `deref()`/`target()` would be cheap insurance. Reachable recursion is handled correctly: direct and indirect self-reference reachable from `start` is rejected ("refers to itself without going through an element"), and recursion through an element is correctly allowed (the `active` set resets at element boundaries).

3. **Test runner masks crashes on `incorrect` schemas** (`ts/tests/RelaxNGTestSuite.ts`): *any* exception during schema load counts as a pass, so a stack overflow or unexpected runtime error would be indistinguishable from a proper rejection. (For invalid *instances* the runner does require the message to contain `RelaxNG validation error` — good.) Consider logging the error class for incorrect-schema cases.

4. **Misleading error order in `RelaxNGDefaultValues.checkAttribute`**: the default value is matched against the pattern *before* the context-dependent-datatype check, so a QName-typed defaulted attribute fails with "does not match its pattern" instead of the more accurate "cannot use a context-dependent datatype". Cosmetic.

5. **Stale grammar state on handler reuse** (pre-existing design, not RelaxNG-specific): `DOMBuilder.initialize()` does not reset `grammar`, and `RelaxNGGrammar` holds mutable `validator`/`scopes`. Reusing one parser+handler pair across documents is safe when each document has its own `xml-model` PI (grammar is reloaded — verified), and `GrammarCache.get()` returns `RelaxNGGrammar.copy()` (fresh state — verified). The residual risk: reuse after a parse that *failed mid-validation* with a next document that has no PI of its own would inherit a half-built validator.

6. **Style guide deviation**: `ts/RelaxNGParser.ts` uses 6 template literals (lines 72, 90, 409, 446, 760, 810); the project instructions mandate string concatenation. The rest of the RelaxNG sources comply.

7. **Non-file `href` targets are never fetched**: `externalRef`/`include` resolution (`resolveHref`) only tries the catalog and the local filesystem; `http(s)` URIs fail with "target not found". Reasonable for a local parser, but worth documenting as a deliberate limitation.

8. **No facet-consistency checks** in `XsdDatatypeLibrary` (e.g. `minLength` > `maxLength`, `fractionDigits` > `totalDigits` are accepted). Harmless for validation results; stricter schema diagnostics would be nicer.

9. **Defaults harvesting is scope-blind for nested grammars**: `RelaxNGParser.harvestDefinitions()` flattens *all* `define`s (including those in nested grammars) into one map, merging same-named ones, and `collectAttributeDefaultsFromPattern()` resolves `parentRef` against that flat map. For schemas with nested grammars that reuse define names, harvested default attributes can come from the wrong definition. Validation itself (`PatternBuilder`) uses proper scopes and is unaffected.

## Verified correct (spec-compliance checklist)

**Core algorithm** (`ts/relaxng/Pattern.ts`): `textDeriv`, `startTagOpenDeriv` (+`applyAfter`), `attDeriv`, `startTagCloseDeriv`, `endTagDeriv` match the spec's semantics and the reference derivative formulation clause-for-clause, including the `nullable` shortcuts for `group`/`oneOrMore` and the `choice(current, textDeriv(current, ws))` idiom implementing weak matching (spec 6.2.7, weak match rules 1–3). Whitespace-only text between elements is skipped, matching the `ws1, element, ws2` consequent of the spec's element rule. Derivative caches (`openCache`/`closeCache`/`endCache`) are only applied to context-independent operations — correct.

**Restrictions** (`ts/relaxng/RelaxNGRestrictions.ts`): content-type calculus (7.2) with `groupable`/`maximum` matches the spec's inference rules (including `oneOrMore` requiring `groupable(ct, ct)`, which correctly rejects `oneOrMore` of simple content); duplicate-attribute detection (7.3) uses the standard candidate-based `NameClass.overlap`; the infinite-name-class rule correctly resets at element boundaries (matching the post-4.19 reading of the spec); interleave element-overlap and text-on-both-sides (7.4) are enforced. All 17 incorrect 7.3 cases, 10 incorrect 7.4 cases, etc. pass.

**Simplification** (`ts/RelaxNGParser.ts`): annotation removal (4.1), whitespace stripping except in `value`/`param` (4.2), `datatypeLibrary` escaping + absolute-URI/no-fragment check (4.3), `value` defaulting to built-in `token` (4.4), href fragment rejection (4.5), `externalRef` ns-only transfer (4.6), include override semantics — overriding requires an existing define/start, overridden components removed, overrides appended (4.7, modulo bug #2 above), `name`-attribute → `name` child transformation with correct element-vs-attribute `ns` defaulting (4.8), `ns` inheritance from nearest ancestor (4.9), undeclared-prefix errors (4.10), div flattening with `ns`/`datatypeLibrary`/`xmlns:*` copying (4.11 — the `xmlns:*` copying is necessary because the DOM keeps only literal attributes), child-count normalization via folds (4.12), `mixed`/`optional`/`zeroOrMore` rewrites (4.13–4.15), the 4.16 constraints (`anyName`/`nsName` except contents, `xmlns` attribute names, datatype correctness), undefined-ref and missing-start errors (4.18), and the `notAllowed`/`empty` absorptions (4.20–4.21, implemented as `PatternPool` simplifications) all conform.

**Compatibility spec** (`ts/relaxng/RelaxNGDefaultValues.ts`, `PatternBuilder.checkIdCompatibility`): all seven default-value rules (single attribute/element name, value matches pattern, no context-dependent datatype, every choice ancestor has an empty child, at least one choice ancestor, competing definitions carry the same default) and all four ID/IDREF/IDREFS rules (attribute parent, single names, competing attributes share ID-type) are implemented. End-to-end verified: defaults merge into instances, duplicate IDs and dangling IDREFs are rejected, IDREF may forward-reference.

**Datatypes**: built-in `string` (identity) and `token` (normalizeWhiteSpace) equality match spec 6.2.9; the XSD library covers the full type set with facets; multiple `pattern` params are ANDed (each its own group) per the XSD-datatypes-with-RELAX-NG guidelines; QName/NOTATION/ENTITY/ENTITIES are context-dependent and checked against the proper schema-side vs instance-side contexts; `NaN` equality is special-cased; list types split on whitespace per spec 6.2.10.

**Syntax validation**: `RelaxNGSyntaxSchema.ts` embeds the official `relaxng.rng` (James Clark v1.31) schema-for-schemas and validates schemas with the validator itself (bootstrap with `skipSyntaxCheck`) — a nice self-hosting design.

**SAXParser integration**: `xml-model` PI honored with `schematypens` check plus `.rng` fallback; catalog resolution for schema location; defaults merged regardless of the validating flag (as documented); schema compilation is lazy so defaults-only mode never pays for pattern building; `GrammarCache` returns copies; XML 1.0 attribute-value normalization reaches the validator (verified at code-point level); CDATA content participates in validation. Parser+handler reuse after a failed validation works (verified).

**Performance**: pattern interning plus derivative memoization; 20,000 interleaved items validated in ~200 ms; no pathological growth observed.

## Test-suite assessment

`tests/relaxng/spectest.xml` is the official James Clark suite ("For October 26 version of the spec"): 385 test cases → 965 checks (213 incorrect schemas, 172 correct schemas, 289 valid + 291 invalid instances). The runner (`ts/tests/RelaxNGTestSuite.ts`):

- materializes `<resource>`/`<dir>` fixtures into a temp directory per case (23 cases exercise `include`/`externalRef`, sections 4.5–4.7), and cleans up in `finally`;
- skips cases requiring unsupported datatype libraries via `<requires>` (currently 0 skipped);
- for invalid instances, requires the failure message to contain `RelaxNG validation error`, distinguishing validation failures from crashes;
- supports `RNG_CASE=n` for single-case debugging.

Coverage gaps in the *suite data itself* (not the runner's fault): no incorrect-schema cases with `ref` under `attribute`/`list`/`except` (bug #1), no mixed-prefix namespace schemas (bug #3), no include-attribute inheritance cases (bug #2), and no `name` elements combining `ns` with a prefixed QName (bug #4). Adding local regression cases for these four is recommended once fixed.

## Recommendations (priority order)

1. Fix `replaceIncludes()` to transfer the include element's attributes (except `href`) onto the generated div, so `ns`/`datatypeLibrary` reach both the included components and the overrides (bug #2).
2. Make `isRelaxNGElement()` namespace-URI-aware instead of prefix-aware (bug #3) — the parser already tracks `xmlns` bindings; resolve the element's prefix against them.
3. Add the three missing prohibited-path checks for `ref` in `RelaxNGRestrictions` (bug #1) — e.g. reject `RefPattern` outright when `IN_ATTRIBUTE`, `IN_LIST`, or `IN_DATA_EXCEPT` is set, before dereferencing.
4. In `nameAttribute()`, let a prefixed `<name>` override an existing `ns` attribute (bug #5 ordering per spec 4.10).
5. Align `findDefaultValue()`/`isCompatibilityAnnotation()` with the compatibility-annotations namespace check used by `PatternBuilder.defaultValueOf()` (bug #5).
6. Add regression tests for all of the above to the local suite; consider hardening the runner to log unexpected exception types for incorrect-schema cases.
7. Optional: wire `isComplete()` into `RelaxNGGrammar` document end, add a cycle guard in `PatternPool.deref()`, replace the 6 template literals in `RelaxNGParser.ts` per the project style guide.

*Note: per project instructions, no code was changed by this audit; all reproductions used throwaway files under `/tmp`.*
