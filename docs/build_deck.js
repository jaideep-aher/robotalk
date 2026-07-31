/**
 * Builds the robotalk hackathon pitch deck.
 *
 * Palette follows the simulator's dusk art direction: a deep indigo night, the
 * teal of the hero robotaxi as the accent, and the warm horizon orange used
 * sparingly for the numbers that matter.
 */

const pptxgen = require("pptxgenjs");

const NIGHT = "1A1626";
const NIGHT_SOFT = "2A2340";
const TEAL = "14B8A6";
const TEAL_LIGHT = "7FF0DE";
const AMBER = "FF9E5E";
const CORAL = "FB7185";
const PAPER = "FFFFFF";
const INK = "241F33";
const MUTED = "A99FC8";
const MUTED_DARK = "5F5875";

const HEAD = "Cambria";
const BODY = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Jaideep Aher";
pres.title = "robotalk";

/** Add a full-bleed background rectangle in one colour. */
function bg(slide, color) {
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5, fill: { color }, line: { color, width: 0 },
  });
}

/** Section heading used on the light content slides. */
function title(slide, text, color = INK) {
  slide.addText(text, {
    x: 0.7, y: 0.5, w: 11.9, h: 0.9,
    fontFace: HEAD, fontSize: 38, bold: true, color, margin: 0,
  });
}

/** A small teal numbered disc, the repeated motif across the deck. */
function disc(slide, n, x, y, color = TEAL) {
  slide.addShape(pres.ShapeType.ellipse, {
    x, y, w: 0.52, h: 0.52,
    fill: { color }, line: { color, width: 0 },
  });
  slide.addText(String(n), {
    x, y, w: 0.52, h: 0.52,
    fontFace: BODY, fontSize: 16, bold: true, color: NIGHT,
    align: "center", valign: "middle", margin: 0,
  });
}

// ---------------------------------------------------------------- 1. Title
{
  const s = pres.addSlide();
  bg(s, NIGHT);
  s.addText("robotalk", {
    x: 0.9, y: 2.05, w: 9, h: 1.5,
    fontFace: HEAD, fontSize: 78, bold: true, color: TEAL, margin: 0,
  });
  s.addText("Teaching a robotaxi to decide who it should listen to", {
    x: 0.95, y: 3.5, w: 10.5, h: 0.7,
    fontFace: BODY, fontSize: 23, color: PAPER, margin: 0,
  });
  s.addText(
    "Fine-tuned gpt-4o-mini  |  natural speech to a validated JSON command with a safety gate",
    { x: 0.95, y: 4.25, w: 11, h: 0.5, fontFace: BODY, fontSize: 14.5, color: MUTED, margin: 0 }
  );
  s.addText("Jaideep Aher  |  AIPI 540  |  Module 4 Hackathon", {
    x: 0.95, y: 6.35, w: 8, h: 0.4,
    fontFace: BODY, fontSize: 13, color: MUTED_DARK, margin: 0,
  });
  // Quiet dusk horizon, no stripe: a soft glow disc bleeding off the edge.
  s.addShape(pres.ShapeType.ellipse, {
    x: 10.1, y: 1.5, w: 4.6, h: 4.6,
    fill: { color: AMBER, transparency: 78 }, line: { color: AMBER, width: 0 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: 11.0, y: 2.4, w: 2.8, h: 2.8,
    fill: { color: AMBER, transparency: 55 }, line: { color: AMBER, width: 0 },
  });
  s.addNotes(
    "I was in a Waymo. It dropped me on a steep block, tight against the kerb, " +
    "and the door would not open. I wanted to say one thing: move forward two feet. " +
    "There was no way to say it."
  );
}

// ------------------------------------------------------- 2. The problem
{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, "The same five words, two correct answers");

  const card = (x, label, role, verdict, vColor, why) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.75, w: 5.5, h: 3.3, rectRadius: 0.12,
      fill: { color: "F6F4FA" }, line: { color: "E4E0EE", width: 1 },
      shadow: { type: "outer", color: "999999", blur: 10, offset: 2, angle: 90, opacity: 0.18 },
    });
    s.addText(label, {
      x: x + 0.4, y: 2.0, w: 4.7, h: 0.4,
      fontFace: BODY, fontSize: 12, bold: true, color: MUTED_DARK, charSpacing: 1, margin: 0,
    });
    s.addText('"Unlock the doors"', {
      x: x + 0.4, y: 2.42, w: 4.7, h: 0.55,
      fontFace: HEAD, fontSize: 25, bold: true, color: INK, margin: 0,
    });
    s.addText(role, {
      x: x + 0.4, y: 3.05, w: 4.7, h: 0.4,
      fontFace: "Courier New", fontSize: 13, color: TEAL, margin: 0,
    });
    s.addText(verdict, {
      x: x + 0.4, y: 3.55, w: 4.7, h: 0.6,
      fontFace: HEAD, fontSize: 30, bold: true, color: vColor, margin: 0,
    });
    s.addText(why, {
      x: x + 0.4, y: 4.2, w: 4.7, h: 0.7,
      fontFace: BODY, fontSize: 14, color: MUTED_DARK, margin: 0,
    });
  };

  card(0.7, "SPOKEN FROM THE PAVEMENT", "actor_role = external", "REJECT", CORAL,
    "A stranger next to a car has no claim on it.");
  card(7.0, "SPOKEN FROM THE BACK SEAT", "actor_role = passenger", "PASS", TEAL,
    "The rider is ending their own trip.");

  s.addText(
    "So the speaker's role is not context passed to the model. It is a required field in the schema, and the gate reasons about it.",
    { x: 0.7, y: 5.45, w: 11.9, h: 0.8, fontFace: BODY, fontSize: 17, italic: true, color: INK, margin: 0 }
  );
  s.addNotes("The hard part is not parsing English. It is that the right answer depends on who is speaking.");
}

// ------------------------------------------------- 3. Model and strategy
{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, "What was fine-tuned, and how");

  const rows = [
    ["Base model", "gpt-4o-mini (2024-07-18)"],
    ["Strategy", "Supervised fine-tuning on 400 labelled pairs"],
    ["Task", "(utterance, actor_role)  ->  validated JSON command"],
    ["Corpus", "Synthetic, generated and validated by schema round trip"],
    ["Held out", "100 rows, stratified by category"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 1.65 + i * 0.72;
    s.addText(k, {
      x: 0.7, y, w: 2.7, h: 0.5,
      fontFace: BODY, fontSize: 15, bold: true, color: MUTED_DARK, margin: 0, valign: "middle",
    });
    s.addText(v, {
      x: 3.5, y, w: 5.6, h: 0.5,
      fontFace: BODY, fontSize: 16, color: INK, margin: 0, valign: "middle",
    });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: 9.35, y: 1.6, w: 3.3, h: 3.9, rectRadius: 0.12,
    fill: { color: NIGHT }, line: { color: NIGHT, width: 0 },
  });
  s.addText("The schema enforces its own contract", {
    x: 9.65, y: 1.85, w: 2.7, h: 0.9,
    fontFace: HEAD, fontSize: 17, bold: true, color: TEAL_LIGHT, margin: 0,
  });
  s.addText(
    [
      { text: "A reject must carry a reason", options: { bullet: true, breakLine: true } },
      { text: "and collapse intent to a safe no-op", options: { bullet: true, breakLine: true } },
      { text: "A clarify must ask a question", options: { bullet: true, breakLine: true } },
      { text: "A pass carries neither", options: { bullet: true } },
    ],
    { x: 9.65, y: 2.85, w: 2.75, h: 2.3, fontFace: BODY, fontSize: 12.5, color: PAPER, paraSpaceAfter: 7, margin: 0 }
  );

  s.addText(
    "Every generated label had to round trip through the validator before it was kept, so the corpus cannot contain a row that names the unsafe action while claiming to refuse it.",
    { x: 0.7, y: 5.5, w: 8.3, h: 1.0, fontFace: BODY, fontSize: 15, color: MUTED_DARK, margin: 0 }
  );
  s.addNotes("Invalid labels were regenerated. 400 train, 100 held out, 100 percent schema validity.");
}

// ------------------------------------------------------- 4. The corpus
{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, "Six categories, chosen around the failure modes");

  const cats = [
    ["Benign passenger", "30%", "Ordinary, clearly safe trip commands"],
    ["Unsafe or illegal", "20%", "Must be refused whoever asks"],
    ["External authority", "20%", "Where being outside decides the answer"],
    ["Ambiguous", "15%", "Under specified, must ask rather than guess"],
    ["Adversarial", "10%", "Social engineering and injected authority"],
    ["Irrelevant", "5%", "Chatter that maps to no action"],
  ];
  cats.forEach(([name, pct, desc], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.7 + col * 6.25;
    const y = 1.7 + row * 1.5;
    disc(s, i + 1, x, y + 0.1);
    s.addText(name, {
      x: x + 0.72, y, w: 3.3, h: 0.42,
      fontFace: HEAD, fontSize: 18, bold: true, color: INK, margin: 0,
    });
    s.addText(pct, {
      x: x + 4.05, y, w: 1.0, h: 0.42,
      fontFace: HEAD, fontSize: 18, bold: true, color: TEAL, align: "right", margin: 0,
    });
    s.addText(desc, {
      x: x + 0.72, y: y + 0.44, w: 4.4, h: 0.5,
      fontFace: BODY, fontSize: 13, color: MUTED_DARK, margin: 0,
    });
  });

  s.addText(
    "The external and adversarial categories exist because refusing everyone outside the car is not safe either, it is just useless.",
    { x: 0.7, y: 6.15, w: 11.9, h: 0.7, fontFace: BODY, fontSize: 15, italic: true, color: INK, margin: 0 }
  );
  s.addNotes("A car that will not move for the resident whose driveway it blocks is its own kind of hazard.");
}

// -------------------------------------------------------- 5. Before/after
{
  const s = pres.addSlide();
  bg(s, NIGHT);
  s.addText("Before and after, on the held out split", {
    x: 0.7, y: 0.45, w: 11.9, h: 0.8,
    fontFace: HEAD, fontSize: 36, bold: true, color: PAPER, margin: 0,
  });
  s.addText("Parsing was never the problem. Judgement was.", {
    x: 0.7, y: 1.18, w: 11.9, h: 0.45,
    fontFace: BODY, fontSize: 16, color: MUTED, margin: 0,
  });

  s.addChart(
    pres.ChartType.bar,
    [
      { name: "Base", labels: ["Gate accuracy", "Intent accuracy", "Clarification"], values: [77, 70, 33.3] },
      { name: "Fine-tuned", labels: ["Gate accuracy", "Intent accuracy", "Clarification"], values: [90, 87, 86.7] },
    ],
    {
      x: 0.6, y: 1.85, w: 7.4, h: 3.5,
      barDir: "col", chartColors: [MUTED_DARK, TEAL],
      showValue: true, dataLabelPosition: "outEnd",
      dataLabelColor: PAPER, dataLabelFontFace: BODY, dataLabelFontSize: 11,
      showLegend: true, legendPos: "t", legendColor: PAPER, legendFontFace: BODY, legendFontSize: 12,
      catAxisLabelColor: MUTED, catAxisLabelFontFace: BODY, catAxisLabelFontSize: 12,
      valAxisLabelColor: MUTED, valAxisLabelFontFace: BODY, valAxisLabelFontSize: 11,
      valAxisMaxVal: 100, valGridLine: { color: NIGHT_SOFT, size: 1 },
      catGridLine: { style: "none" }, plotArea: { fill: { color: NIGHT } },
      chartArea: { fill: { color: NIGHT } },
    }
  );

  // The two numbers that carry the argument.
  const stat = (x, y, value, label, sub, color) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 4.5, h: 1.62, rectRadius: 0.12,
      fill: { color: NIGHT_SOFT }, line: { color: NIGHT_SOFT, width: 0 },
    });
    s.addText(value, {
      x: x + 0.3, y: y + 0.18, w: 2.0, h: 0.95,
      fontFace: HEAD, fontSize: 44, bold: true, color, margin: 0, valign: "middle",
    });
    s.addText(label, {
      x: x + 2.25, y: y + 0.25, w: 2.0, h: 0.45,
      fontFace: BODY, fontSize: 13.5, bold: true, color: PAPER, margin: 0,
    });
    s.addText(sub, {
      x: x + 2.25, y: y + 0.68, w: 2.05, h: 0.7,
      fontFace: BODY, fontSize: 11.5, color: MUTED, margin: 0,
    });
  };
  stat(8.3, 1.95, "8.1 to 0", "Unsafe compliance", "Must-refuse commands let through", TEAL_LIGHT);
  stat(8.3, 3.72, "12.5 to 2.1", "False refusal", "Safe commands wrongly refused", AMBER);

  s.addText(
    "Schema validity was 100 percent before and after. Speech quality moved 4.83 to 4.97, which is reported as no regression rather than a gain: one judge over 30 samples cannot separate those.",
    { x: 0.6, y: 5.75, w: 12.2, h: 0.9, fontFace: BODY, fontSize: 13.5, color: MUTED, margin: 0 }
  );
  s.addNotes("Unsafe compliance is the metric that matters. The base model leaked about one in twelve. The tuned model leaked none.");
}

// ------------------------------------------------------------- 6. The app
{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, "The demo makes the claim checkable");

  s.addText(
    "A dusk city where you speak to the cab and watch the gate decide. The whole pipeline is on screen: what you said, the raw model JSON, the colour coded verdict, the action taken, and what the car says back.",
    { x: 0.7, y: 1.5, w: 7.3, h: 1.1, fontFace: BODY, fontSize: 16, color: INK, margin: 0 }
  );

  const bullets = [
    ["Runs inference on the fine-tuned model", "The key stays server side behind /parse"],
    ["Switchable point of view", "Passenger, pedestrian on foot, or chase camera"],
    ["Staged scenarios", "Including the two that prompted this project"],
    ["Base and fine-tuned toggle", "Same sentence, both models, live"],
  ];
  bullets.forEach(([h, d], i) => {
    const y = 2.85 + i * 0.92;
    disc(s, i + 1, 0.7, y);
    s.addText(h, {
      x: 1.42, y: y - 0.04, w: 6.5, h: 0.4,
      fontFace: HEAD, fontSize: 17, bold: true, color: INK, margin: 0,
    });
    s.addText(d, {
      x: 1.42, y: y + 0.34, w: 6.5, h: 0.4,
      fontFace: BODY, fontSize: 13, color: MUTED_DARK, margin: 0,
    });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: 8.5, y: 1.5, w: 4.2, h: 5.0, rectRadius: 0.14,
    fill: { color: NIGHT }, line: { color: NIGHT, width: 0 },
  });
  s.addText("Two scenarios from riding in one", {
    x: 8.8, y: 1.78, w: 3.6, h: 0.8,
    fontFace: HEAD, fontSize: 18, bold: true, color: TEAL_LIGHT, margin: 0,
  });
  s.addText(
    '"Move forward a bit, I cannot open my door."',
    { x: 8.8, y: 2.65, w: 3.6, h: 0.75, fontFace: BODY, fontSize: 14, italic: true, color: PAPER, margin: 0 }
  );
  s.addText("Stopped on a steep block, door jammed against the kerb. Needs metres, not a destination.", {
    x: 8.8, y: 3.4, w: 3.6, h: 0.9, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0,
  });
  s.addText(
    '"I do not feel safe here, drop me at the next block."',
    { x: 8.8, y: 4.4, w: 3.6, h: 0.75, fontFace: BODY, fontSize: 14, italic: true, color: PAPER, margin: 0 }
  );
  s.addText("Moving the stop is a safety feature, not a convenience.", {
    x: 8.8, y: 5.15, w: 3.6, h: 0.8, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0,
  });
  s.addNotes("Live: stranger asks to unlock, rejected. Rider asks the same, granted, doors flash.");
}

// ------------------------------------------------------ 7. Risks / ethics
{
  const s = pres.addSlide();
  bg(s, NIGHT);
  s.addText("What I would push on if I were reviewing this", {
    x: 0.7, y: 0.5, w: 11.9, h: 0.9,
    fontFace: HEAD, fontSize: 34, bold: true, color: PAPER, margin: 0,
  });

  const risks = [
    ["The data is synthetic", "One model's idea of what people say. Real riders are drunk, panicking, or speaking a second language. Zero unsafe compliance is zero against a test set from the same generator."],
    ["Authority is asserted, not verified", "The system trusts a role label it is handed. In a real car that has to come from which door opened or who booked the ride, not from the sentence, because the sentence is what an attacker controls."],
    ["Evaluation is harder than the model", "The commands that matter are rare, so aggregate accuracy hides them. And a fluent refusal for the wrong reason scores the same as the right one."],
    ["Failing closed still has a cost", "Stopping is the safe default in language, but a robotaxi stopping unexpectedly in traffic is not a neutral act."],
  ];
  risks.forEach(([h, d], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.7 + col * 6.25;
    const y = 1.7 + row * 2.5;
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 5.75, h: 2.15, rectRadius: 0.12,
      fill: { color: NIGHT_SOFT }, line: { color: NIGHT_SOFT, width: 0 },
    });
    s.addText(h, {
      x: x + 0.35, y: y + 0.22, w: 5.05, h: 0.45,
      fontFace: HEAD, fontSize: 17, bold: true, color: TEAL_LIGHT, margin: 0,
    });
    s.addText(d, {
      x: x + 0.35, y: y + 0.72, w: 5.05, h: 1.25,
      fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0,
    });
  });
  s.addNotes("The honest reading of zero percent is that it is zero on my test set, not zero in the world.");
}

// ----------------------------------------------------------- 8. Close
{
  const s = pres.addSlide();
  bg(s, NIGHT);
  s.addShape(pres.ShapeType.ellipse, {
    x: -1.6, y: 3.4, w: 5.2, h: 5.2,
    fill: { color: TEAL, transparency: 85 }, line: { color: TEAL, width: 0 },
  });

  s.addText("The part worth defending", {
    x: 0.9, y: 1.3, w: 11.5, h: 0.7,
    fontFace: BODY, fontSize: 16, color: MUTED, margin: 0,
  });
  s.addText(
    "Putting the speaker's role inside the schema, not around it",
    { x: 0.9, y: 1.95, w: 11.2, h: 1.5, fontFace: HEAD, fontSize: 40, bold: true, color: PAPER, margin: 0 }
  );
  s.addText(
    "It turns a subjective safety question into a field a validator can check and a metric can measure.",
    { x: 0.9, y: 3.5, w: 10.5, h: 0.7, fontFace: BODY, fontSize: 18, color: TEAL_LIGHT, margin: 0 }
  );

  s.addText("Live demo", {
    x: 0.9, y: 4.85, w: 3.2, h: 0.35,
    fontFace: BODY, fontSize: 12, bold: true, color: MUTED_DARK, charSpacing: 1, margin: 0,
  });
  s.addText("robotalk-web-production.up.railway.app", {
    x: 0.9, y: 5.2, w: 6.2, h: 0.45,
    fontFace: BODY, fontSize: 15, color: PAPER, margin: 0,
  });
  s.addText("Code", {
    x: 7.4, y: 4.85, w: 3.2, h: 0.35,
    fontFace: BODY, fontSize: 12, bold: true, color: MUTED_DARK, charSpacing: 1, margin: 0,
  });
  s.addText("github.com/jaideep-aher/robotalk", {
    x: 7.4, y: 5.2, w: 5.2, h: 0.45,
    fontFace: BODY, fontSize: 15, color: PAPER, margin: 0,
  });
  s.addNotes("Thank you.");
}

pres.writeFile({ fileName: "robotalk-pitch.pptx" }).then(() => console.log("wrote robotalk-pitch.pptx"));
