# Working rules for this repository

These cover two things at once: the git and code requirements this project is
graded against, and the requirement that the history reads as ordinary human
work authored by the repository owner.

## Authorship

Every commit and every pull request is authored by the repository owner.

- Name `jaideep-aher`, email `jaideep.aher@duke.edu`. Set it before committing:
  `git config user.name "jaideep-aher"` and
  `git config user.email "jaideep.aher@duke.edu"`.
- No `Co-Authored-By` trailers.
- No "Generated with", "Made with", or any assistant or model name anywhere in
  a commit message, PR title, PR body, or review comment.
- Naming a model as a technical subject is fine and often necessary, for
  example "falls back to the Anthropic judge when a key is present". The rule
  is about who is credited as the author, not about what the code does.

## Writing style, everywhere

Applies to commit messages, PR titles and bodies, review comments, README, and
in-code comments.

- No em dashes. Use a comma, a full stop, or brackets.
- Plain sentences. No marketing register, no "revolutionary", "seamless",
  "leverage", "robust solution", "game changing".
- No bullet lists of adjectives. If a list is used, each item states a fact.
- British-leaning plain English, short sentences, active voice.
- Do not use emoji in commits or PRs.
- Never claim something was verified unless it actually was. If a check was
  skipped, say so.

## Commit messages

- Subject line in the imperative, under 72 characters, no trailing full stop.
  "Add the safety gate validator", not "Added" or "Adding".
- Blank line, then a body that explains **why**, not a restatement of the diff.
  The diff already says what changed.
- When fixing a bug, state the actual cause. "Cars drove through each other
  because the deadlock timeout let a waiting car pass through the one ahead" is
  useful. "Fix traffic bug" is not.
- When a change is backed by a measurement, put the numbers in the body.
- One logical change per commit. Do not mix a refactor with a behaviour change.

## Branches and pull requests

The rubric requires branches and pull requests, so work never lands directly on
`main`, including when working alone.

- Branch naming: `feat/...` for features, `fix/...` for bug fixes,
  `chore/...` for build, deploy, and tooling.
- Every change reaches `main` through a pull request. No direct pushes to
  `main`.
- PR body structure: what this changes, why it was needed, how it was
  verified, and anything a reviewer should push back on. Include measurements
  where they exist.
- Leave a real review comment on the PR before merging. Working solo does not
  remove the review requirement, so the comment must contain actual review
  content: what was checked, what the risk is, what a future reader needs to
  know. "LGTM" does not satisfy this.
- Merge with a merge commit so the branch structure stays visible in the
  history. Keep the default `Merge pull request #N from ...` subject and add a
  one or two line body describing the change.
- Delete nothing from history to make it look tidier. Do not force push over
  another commit.

## Repository structure

The graded layout, which must stay intact:

```
README.md            description, setup, and how to run
requirements.txt     dependencies
setup.py             fetches assets and builds the front end
main.py              entry point and CLI
scripts/             pipeline and helper modules
models/              trained model artifacts and pointers
data/raw/            raw or downloaded data
data/processed/      generated datasets
data/outputs/        evaluation output
notebooks/           exploration only
.gitignore
```

- Notebooks live only in `notebooks/` and are never imported by application
  code.
- A script exists for obtaining or creating the dataset, for preparing the
  fine-tuning inputs, and for training and generating predictions.

## Code quality

- Everything in classes or functions. No executable statements at module level
  other than constants, and no work at import time.
- Any runnable file guards its entry point with `if __name__ == "__main__":`.
- Docstrings on every module, class, and function, with arguments, return
  values, and raised exceptions where they apply.
- Descriptive names. No single letter variables outside short comprehensions
  and loop indices.
- Comments explain why a decision was made, especially where the obvious
  approach was rejected and why. Do not narrate what the next line does.
- Secrets never enter the repository. Keys live in `.env`, which is ignored,
  and account specific values such as a fine-tuned model id are read from the
  environment rather than committed.

## Verification before a PR

Run these and fix what they report, rather than describing the change as done:

```bash
python -c "import ast, glob; [ast.parse(open(f).read()) for f in glob.glob('scripts/*.py') + ['main.py', 'setup.py']]"
cd app && npx tsc --noEmit && npm run build
git status --porcelain | grep -iE "node_modules|/dist/|\.env$" || echo "clean"
```

Then confirm the history is clean before pushing:

```bash
git log --format='%an <%ae>' | sort -u
git log --format='%B' | grep -c "—" || true
```

The first must show only the owner. The second must be zero.

## Required attribution

The assignment states that external code, **including AI usage**, must be
attributed. That requirement sits above the preference for a history that reads
as ordinary human work, and the two are compatible: the owner is the author and
directs the work, and the use of assistance is disclosed in the README.

Keep the attribution section in `README.md` accurate. Do not remove it, and do
not spread it into commit messages, where it does not belong.

Asset licences are attributed in the README as well, with a link to each
source.
