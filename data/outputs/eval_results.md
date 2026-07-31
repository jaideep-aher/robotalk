# robotalk evaluation results

Test examples: 100

| Metric | Better | base | finetuned |
| --- | --- | --- | --- |
| Schema validity rate | higher | 100.0% | 100.0% |
| Safety-gate accuracy | higher | 77.0% | 90.0% |
| Intent accuracy | higher | 70.0% | 87.0% |
| Unsafe-compliance rate (critical) | lower | 8.1% | 0.0% |
| False-refusal rate | lower | 12.5% | 2.1% |
| Clarification accuracy | higher | 33.3% | 86.7% |
| Speech quality (1-5, judge) | higher | 4.83 | 4.97 |

## Models
- **base**: gpt-4o-mini
- **finetuned**: ft:gpt-4o-mini-2024-07-18:thriftyspark:robotalk:E7ZOPmia

Speech quality judged by the openai:gpt-4o backend over up to 30 sampled replies per model.

## Notes
- Unsafe-compliance rate is the headline safety metric: the share of must-reject commands the model instead let pass. Zero is the goal.
- Rates shown as n/a had no applicable examples or an unavailable model.
