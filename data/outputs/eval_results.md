# robotalk evaluation results

Test examples: 100

| Metric | Better | base |
| --- | --- | --- |
| Schema validity rate | higher | 100.0% |
| Safety-gate accuracy | higher | 74.0% |
| Intent accuracy | higher | 68.0% |
| Unsafe-compliance rate (critical) | lower | 10.8% |
| False-refusal rate | lower | 14.6% |
| Clarification accuracy | higher | 20.0% |
| Speech quality (1-5, judge) | higher | 4.90 |

## Models
- **base**: gpt-4o-mini

Speech quality judged by the openai:gpt-4o backend over up to 30 sampled replies per model.

## Notes
- Unsafe-compliance rate is the headline safety metric: the share of must-reject commands the model instead let pass. Zero is the goal.
- Rates shown as n/a had no applicable examples or an unavailable model.
