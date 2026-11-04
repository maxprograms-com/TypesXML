# Review of AUDIT.md

I checked every item against the code. For the bugs I also ran reproductions against `dist/cjs`.

## Summary

| Item | Verdict |
|---|---|
| Bug 1: `ref` prohibited paths | False positive. |
| Bug 2: `include` attributes | Real. Reproduced. |
| Bug 3: foreign element detection by prefix | Real. Reproduced. |
| Bug 4: prefixed `name` must override `ns` | Real. Reproduced. |
| Bug 5: `defaultValue` matched by local name | Real. Confirmed in the code. |
| Item 1 | Real. |
| Item 2 | Not a bug today. |
| Item 3 | Real. |
| Item 4 | Real. |
| Item 5 | Not a bug. |
| Item 6 | Real. |
| Item 7 | Not a bug. |
| Item 8 | Real. |
| Item 9 | Real. |

## Bug 1: false positive

Spec 4.19 replaces every `ref` to a non-element `define` with the define's body. Only refs to element definitions survive. The section 7 restrictions run after that step, so `attribute//ref`, `list//ref` and `data/except//ref` effectively mean "an element inside".

`RelaxNGRestrictions.visit` (lines 84-99) does the same thing. It follows the ref and checks the body, or checks the element when the target is one.

The three examples in the audit are valid RelaxNG:

- `<attribute name="bar"><ref name="x"/></attribute>` with x = `<data type="string"/>`
- `<list><ref name="x"/></list>` with x = `<data type="string"/>`
- `<data type="string"><except><ref name="x"/></except></data>` with x = `<value>bad</value>`

Rejecting them would break correct schemas. The audit's recommendation 3 is wrong.

## Bug 2: `include` does not pass its attributes to the div (spec 4.7)

Real. `replaceIncludes` ([RelaxNGParser.ts:423](ts/RelaxNGParser.ts#L423)) creates the div with no attributes. It only copies `ns` from the include onto the included grammar's root. The include's own `start` and `define` children therefore inherit neither `ns` nor `datatypeLibrary`.

Reproduced:

- `<include href="inc.rng" ns="http://e.com">` with an overriding `<element name="foo">`. The instance `<foo xmlns="http://e.com"/>` is rejected: `element "foo" is not allowed here; expected: foo`.
- `<include datatypeLibrary="...XMLSchema-datatypes">` with an overriding `<data type="int"/>` fails with `Unknown built-in RelaxNG datatype "int"`.

Note: `inheritAttribute` is correct for `externalRef` (spec 4.6 transfers only `ns`). The fix applies to `include` only: put all include attributes except `href` on the div.

## Bug 3: foreign elements are detected by prefix (spec 4.1)

Real. `isRelaxNGElement` ([RelaxNGParser.ts:791](ts/RelaxNGParser.ts#L791)) compares the element's prefix with the root's prefix. A schema that binds the RelaxNG namespace both as a prefix and as the default namespace, and mixes the two spellings, loses elements.

Reproduced for both directions:

- `<rng:grammar xmlns:rng=... xmlns=...>` with an unprefixed `<start>`
- `<grammar xmlns=... xmlns:rng=...>` with `<rng:start>`

Both give `RelaxNG grammar has no start element`. The check must resolve the element's prefix to a namespace URI and compare that with the RelaxNG namespace.

## Bug 4: a prefixed `name` must replace an existing `ns` (spec 4.10)

Real. `nameAttribute` ([RelaxNGParser.ts:638](ts/RelaxNGParser.ts#L638)) only handles a `name` element when it has no own `ns`. `<name ns="http://wrong">p:bar</name>` therefore keeps `http://wrong`. Reproduced: the instance `<bar xmlns="http://right"/>` is rejected with `expected: {http://wrong}bar`.

## Bug 5: `defaultValue` matched by local name only

Real. `findDefaultValue` and `isCompatibilityAnnotation` ([RelaxNGParser.ts:265](ts/RelaxNGParser.ts#L265), [RelaxNGParser.ts:783](ts/RelaxNGParser.ts#L783)) accept any attribute or element called `defaultValue`, in any namespace. `PatternBuilder.defaultValueOf` correctly requires the compatibility annotations namespace. A foreign `x:defaultValue` gets merged into instances but is ignored by the compatibility checks.

## Other items

1. `RelaxNGValidator.isComplete()` is dead code. Verdict: real. Nothing calls it. The root's `endTagDeriv` already rejects incomplete content, so the method is redundant.
2. Latent cycle in `deref()` / `target()` ([Pattern.ts:240](ts/relaxng/Pattern.ts#L240)). Verdict: not a bug today. The loop has no guard, but no input reaches it: unreachable defines are never dereferenced, and reachable recursion is rejected by loop detection.
3. The test runner counts any exception on an `incorrect` schema as a pass ([RelaxNGTestSuite.ts:117-123](ts/tests/RelaxNGTestSuite.ts#L117)). Verdict: real. A crash during schema load is indistinguishable from a correct rejection, so the runner can hide a crash.
4. Error order in `checkAttribute` ([RelaxNGDefaultValues.ts:103-108](ts/relaxng/RelaxNGDefaultValues.ts#L103)). Verdict: real. The error message is wrong: a QName default gets "does not match its pattern" instead of "context-dependent datatype".
5. Stale grammar state after a failed parse with handler reuse. Verdict: not a bug. `DOMBuilder.initialize()` ([DOMBuilder.ts:41](ts/DOMBuilder.ts#L41)) does not reset `grammar`, but `SAXParser` calls it at the start of every parse ([SAXParser.ts:262](ts/SAXParser.ts#L262)) and every document with a grammar reference gets a fresh grammar through `setGrammar`. A stale grammar is only seen when the previous parse failed mid-validation and the next document has no grammar reference. DTD and XML Schema grammars behave the same way, and the audit shows no wrong result.
6. Template literals: six remain in `RelaxNGParser.ts` (lines 72, 90, 409, 446, 760, 810). Verdict: real. It violates the project rule that requires string concatenation.
7. Remote `href` targets are not fetched. Verdict: not a bug. It is deliberate, like the datatype libraries.
8. No facet consistency checks (`minLength` > `maxLength` and similar). Verdict: real. Facets are only stored, so an inconsistent schema is accepted.
9. Defaults harvesting is scope-blind for nested grammars ([RelaxNGParser.ts:563](ts/RelaxNGParser.ts#L563)). Verdict: real. Same-named defines in different grammars are merged into one, so a default attribute can come from the wrong definition.

No code has been changed.
