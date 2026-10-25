# 0003 Agents' seen claims are re-run by a model-free verifier

**Status:** accepted.

**Decision.**
- Agents record claims. They never write `observed` evidence.
- After each turn the verifier re-runs every `seen` claim with a predicate it supports, and marks it verified, refuted or unverifiable.
- Verdicts feed calibration per provider and account.

**Why.** In the debate, every advocate's design rested on rea's evidence record. Two advocates independently arrived at a model-free first pass. The outsider candidate argued that checking claims scales better than producing them as models improve.

**Consequences.**
- Only claims that map to a predicate can be checked. Today that is 10 predicates.
- The false-verified rate is gated at 0 on the benchmark corpus.
