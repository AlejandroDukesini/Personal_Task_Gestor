import { describe, expect, it } from "vitest";
import { loadDb } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { findTime, parseCalendarText, parseDateHeader, resolveDate, type OcrLine } from "./parse";
import { matchHabits, nameSimilarity } from "./match";
import { ImageValidationError, checkDimensions, sniffImageType, validateImageFile } from "./ocr";

/** Línea OCR sintética: texto en (x, y) con ancho proporcional al texto. */
function L(text: string, x: number, y: number, conf = 92, w?: number): OcrLine {
  const width = w ?? text.length * 9;
  const words = text.split(" ").reduce<{ acc: OcrLine["words"]; x: number }>(
    (s, word) => {
      s.acc!.push({ text: word, confidence: conf, bbox: { x0: s.x, y0: y, x1: s.x + word.length * 9, y1: y + 16 } });
      s.x += word.length * 9 + 9;
      return s;
    },
    { acc: [], x }
  ).acc;
  return { text, confidence: conf, bbox: { x0: x, y0: y, x1: x + width, y1: y + 16 }, words };
}

describe("lectura de horas", () => {
  it.each([
    ["8:00 – 8:30 p. m.", "20:00", "20:30"],
    ["20:00 - 20:30", "20:00", "20:30"],
    ["6 – 7 a. m.", "06:00", "07:00"],
    ["11:30 – 1 p. m.", "11:30", "13:00"],
    ["9:15am to 10am", "09:15", "10:00"],
    ["Leer, 8 p. m.", "20:00", null],
    ["07:45", "07:45", null],
    ["8:0O p.rn.", "20:00", null],
    ["12 a. m. – 1 a. m.", "00:00", "01:00"],
  ])("%s", (text, start, end) => {
    expect(findTime(text)).toMatchObject({ start, end });
  });

  it("no confunde números de día o años con horas", () => {
    expect(findTime("30")).toBeNull();
    expect(findTime("2026")).toBeNull();
    expect(findTime("29 - 30")).toBeNull();
    expect(findTime("25:00")).toBeNull();
  });
});

describe("lectura de fechas", () => {
  it("cabeceras de agenda en español e inglés", () => {
    expect(parseDateHeader("30 SEP, MIÉ", "2026-09-28")?.date).toBe("2026-09-30");
    expect(parseDateHeader("mié, 30 sept", "2026-09-28")?.date).toBe("2026-09-30");
    expect(parseDateHeader("Jueves, 1 de octubre de 2026", "2026-09-28")?.date).toBe("2026-10-01");
    expect(parseDateHeader("Thu, Oct 1", "2026-09-28")?.date).toBe("2026-10-01");
    expect(parseDateHeader("MAR 29", "2026-09-28")?.date).toBe("2026-09-29"); // martes
    expect(parseDateHeader("Leer un libro", "2026-09-28")).toBeNull();
  });

  it("no inventa: día sin mes ni día de semana equidistante → sin fecha", () => {
    expect(resolveDate({ day: 15 }, "2026-09-30")).toBeNull();
    expect(resolveDate({ day: 1, weekday: 4 }, "2026-09-30")).toBe("2026-10-01");
    expect(resolveDate({ day: 30, weekday: 1 }, "2026-09-30")).toBeNull(); // no hay lunes 30 cerca
  });
});

describe("capturas de distintas vistas", () => {
  it("vista semana (escritorio): columnas por día, eje de horas y ruido de interfaz", () => {
    const heads = ["LUN 28", "MAR 29", "MIÉ 30", "JUE 1", "VIE 2"];
    const lines: OcrLine[] = [
      L("Hoy", 20, 20),
      L("septiembre de 2026", 120, 20),
      L("GMT-05", 10, 110),
      ...heads.map((t, i) => L(t, 180 + i * 150, 100)),
      // Eje: 6 a. m. en y=300, una hora = 60 px.
      ...["6 a. m.", "7 a. m.", "8 a. m.", "9 a. m."].map((t, i) => L(t, 10, 292 + i * 60, 90, 60)),
      ...["7 p. m.", "8 p. m."].map((t, i) => L(t, 10, 292 + (13 + i) * 60, 90, 60)),
      L("Ejercicio, 6 – 7 a. m.", 182, 300),
      L("Leer", 482, 1142),
      L("8:00 – 8:30 p. m.", 482, 1160),
      L("Meditar", 632, 362), // sin hora visible: se estima por la posición (7 a. m.)
    ];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "auto", imageWidth: 1000 });
    expect(r.view).toBe("week");
    const byTitle = Object.fromEntries(r.events.map((e) => [e.title, e]));
    expect(Object.keys(byTitle).sort()).toEqual(["Ejercicio", "Leer", "Meditar"]);
    expect(byTitle.Ejercicio).toMatchObject({ date: "2026-09-28", startTime: "06:00", endTime: "07:00", durationMin: 60 });
    expect(byTitle.Leer).toMatchObject({ date: "2026-09-30", startTime: "20:00", endTime: "20:30", estimatedTime: false });
    expect(byTitle.Meditar).toMatchObject({ date: "2026-10-01", startTime: "07:00", estimatedTime: true });
    expect(byTitle.Meditar.issues).toContain("Hora estimada por la posición");
    expect(byTitle.Leer.confidence).toBeGreaterThan(byTitle.Meditar.confidence);
  });

  it("vista agenda (móvil): la fecha a la izquierda del primer evento del día", () => {
    const lines = [
      L("30 MIÉ", 20, 100, 90, 60),
      L("Leer", 120, 95),
      L("8:00 – 8:30 p. m.", 120, 115),
      L("1 JUE", 20, 200, 90, 60),
      L("Ejercicio", 120, 195),
      L("6:00 – 7:00 a. m.", 120, 215),
      L("Tomar agua", 120, 260),
      L("10:00 – 10:15 a. m.", 120, 280),
    ];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "auto", imageWidth: 400 });
    expect(r.view).toBe("agenda");
    expect(r.events.map((e) => [e.title, e.date, e.startTime, e.endTime])).toEqual([
      ["Leer", "2026-09-30", "20:00", "20:30"],
      ["Ejercicio", "2026-10-01", "06:00", "07:00"],
      ["Tomar agua", "2026-10-01", "10:00", "10:15"],
    ]);
  });

  it("vista agenda (escritorio): hora y título en la misma línea", () => {
    const lines = [L("MIÉ, 30 SEPT", 20, 50), L("8:00 – 8:30 p. m. • Leer", 200, 50), L("JUE, 1 OCT", 20, 120), L("6 – 7 a. m. • Gimnasio", 200, 120)];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "auto", imageWidth: 800 });
    expect(r.events.map((e) => [e.title, e.date, e.startTime])).toEqual([
      ["Leer", "2026-09-30", "20:00"],
      ["Gimnasio", "2026-10-01", "06:00"],
    ]);
  });

  it("vista día: usa la fecha confirmada por el usuario", () => {
    const r = parseCalendarText([L("Leer", 100, 500), L("8 – 8:30 p. m.", 100, 518)], { referenceDate: "2026-09-30", view: "day", imageWidth: 400 });
    expect(r.events[0]).toMatchObject({ title: "Leer", date: "2026-09-30", startTime: "20:00", endTime: "20:30" });
  });

  it("captura ambigua o incompleta: sin nombre / sin fecha → se marca para confirmar, no se inventa", () => {
    const lines = [L("LUN", 180, 100, 60), L("MAR", 330, 100, 60), L("8:00 – 8:30 p. m.", 182, 400, 55)];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "week", imageWidth: 800 });
    expect(r.events).toHaveLength(1);
    const [e] = r.events;
    expect(e.title).toBe("");
    expect(e.date).toBeNull();
    expect(e.issues).toEqual(expect.arrayContaining(["Nombre no legible: escríbelo", "Fecha no legible: confírmala"]));
    expect(e.confidence).toBeLessThan(0.3);
    expect(r.warnings.join(" ")).toMatch(/columnas no tienen fecha/);
  });

  it("captura ilegible: sin eventos y con aviso", () => {
    const r = parseCalendarText([L("~~ ##", 10, 10, 20)], { referenceDate: "2026-09-28", view: "auto", imageWidth: 400 });
    expect(r.events).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/No se reconocieron eventos/);
  });
});

describe("coincidencias con hábitos", () => {
  const h = (id: string, name: string, schedules: any[] = []) => ({ id, name, archived: false, schedules }) as any;

  it("nombre equivalente o sinónimo", () => {
    expect(nameSimilarity("Leer", "Leer")).toBe(1);
    expect(nameSimilarity("Leer", "Lectura")).toBeGreaterThanOrEqual(0.75);
    expect(nameSimilarity("Gym", "Ejercicio")).toBeGreaterThanOrEqual(0.75);
    expect(nameSimilarity("Reunión de equipo", "Leer")).toBeLessThan(0.45);
  });

  it("una coincidencia fiable se propone; varias piden elegir; ninguna permite crear", () => {
    const one = matchHabits({ title: "Lectura", date: null, startTime: null }, [h("a", "Leer"), h("b", "Ejercicio")]);
    expect(one).toMatchObject({ kind: "match", habitId: "a" });
    const many = matchHabits({ title: "Leer", date: null, startTime: null }, [h("a", "Leer 20 min"), h("b", "Lectura"), h("c", "Ejercicio")]);
    expect(many.kind).toBe("ambiguous");
    expect(many.candidates.map((c) => c.habitId).slice(0, 2).sort()).toEqual(["a", "b"]);
    const none = matchHabits({ title: "Cita con el dentista", date: null, startTime: null }, [h("a", "Leer")]);
    expect(none.kind).toBe("none");
  });

  it("el horario programado refuerza la coincidencia", () => {
    const sched = { kind: "recurring", freq: "weekly", interval: 1, daysOfWeek: [3], startTime: "20:00", startDate: "2026-09-01", endDate: null, active: true, inactiveFrom: null };
    const withTime = matchHabits({ title: "Leer libro", date: "2026-09-30", startTime: "20:15" }, [h("a", "Leer", [sched]), h("b", "Lectura")]);
    expect(withTime).toMatchObject({ kind: "match", habitId: "a" });
  });
});

describe("importación confirmada", () => {
  async function habit(name = "Leer", dailyTarget = 1) {
    return call("POST", "/habits", { name, dailyTarget });
  }

  it("un evento solo «programado» no registra realización; «realizado» sí, y una sola vez", async () => {
    const h = await habit();
    const item = { title: "Leer", date: "2026-09-29", startTime: "20:00", endTime: "20:30", habitId: h.id };
    const s1 = await call("POST", "/habit-imports/apply", { items: [{ ...item, action: "scheduled" }], imageHash: "abc" });
    expect(s1.counted).toBe(0);
    expect(loadDb().habitLogs.filter((l) => l.habitId === h.id)).toHaveLength(0);

    const s2 = await call("POST", "/habit-imports/apply", { items: [{ ...item, action: "done" }], imageHash: "abc" });
    expect(s2.counted).toBe(1);
    const s3 = await call("POST", "/habit-imports/apply", { items: [{ ...item, action: "done" }], imageHash: "abc" });
    expect(s3).toMatchObject({ counted: 0, skipped: 1 });
    const logs = loadDb().habitLogs.filter((l) => l.habitId === h.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].count).toBe(1);
    expect(logs[0].trail?.[0]).toMatchObject({ source: "import" });
  });

  it("comprobación previa: detecta eventos ya importados (misma captura importada dos veces)", async () => {
    const h = await habit();
    const item = { title: "Leer", date: "2026-09-29", startTime: "20:00", habitId: h.id };
    expect(await call("POST", "/habit-imports/check", { items: [item] })).toEqual([null]);
    await call("POST", "/habit-imports/apply", { items: [{ ...item, action: "done" }] });
    const [prev] = await call("POST", "/habit-imports/check", { items: [{ ...item, title: "  LEER " }] });
    expect(prev).toMatchObject({ action: "done", counted: 1 });
  });

  it("crear un hábito nuevo desde un evento desconocido y añadir su horario sin duplicar", async () => {
    const items = [
      { title: "Yoga", date: "2026-09-30", startTime: "07:00", endTime: "07:45", createHabit: { name: "Yoga" }, action: "done", addSchedule: true },
      { title: "Yoga", date: "2026-10-01", startTime: "07:00", createHabit: { name: "yoga" }, action: "scheduled", addSchedule: true },
    ];
    const s = await call("POST", "/habit-imports/apply", { items });
    expect(s).toMatchObject({ habitsCreated: 1, counted: 1, scheduled: 2 });
    const db = loadDb();
    expect(db.habits.filter((x) => x.name.toLowerCase() === "yoga")).toHaveLength(1);
    expect(db.habitSchedules).toHaveLength(2);
    // Reimportar no crea más horarios.
    await call("POST", "/habit-imports/apply", { items });
    expect(loadDb().habitSchedules).toHaveLength(2);
  });

  it("un horario ya cubierto por una programación recurrente no se duplica", async () => {
    const h = await habit();
    await call("POST", `/habits/${h.id}/schedules`, { kind: "recurring", freq: "weekly", daysOfWeek: [3], startTime: "20:00", startDate: "2026-09-01" });
    const s = await call("POST", "/habit-imports/apply", { items: [{ title: "Leer", date: "2026-09-30", startTime: "20:00", habitId: h.id, action: "scheduled", addSchedule: true }] });
    expect(s.scheduled).toBe(0);
    expect(loadDb().habitSchedules).toHaveLength(1);
  });

  it("los eventos ignorados no cambian nada y los datos inválidos se rechazan", async () => {
    const before = loadDb().habits.length;
    await call("POST", "/habit-imports/apply", { items: [{ title: "Reunión", date: "2026-09-30", action: "ignored", createHabit: { name: "Reunión" } }] });
    expect(loadDb().habits.length).toBe(before);
    expect(loadDb().habitLogs).toHaveLength(0);
    await expectStatus(400, call("POST", "/habit-imports/apply", { items: [{ title: "X", date: "30/09/2026", action: "done" }] }));
    await expectStatus(404, call("POST", "/habit-imports/apply", { items: [{ title: "X", date: "2026-09-30", action: "done", habitId: "no-existe" }] }));
  });

  it("privacidad: no se guarda la imagen, solo los datos confirmados y su huella", async () => {
    const h = await habit();
    await call("POST", "/habit-imports/apply", { items: [{ title: "Leer", date: "2026-09-29", habitId: h.id, action: "done" }], imageHash: "f".repeat(64) });
    const json = JSON.stringify(loadDb());
    expect(json).not.toMatch(/data:image|base64/);
    expect(loadDb().habitImports[0]).toMatchObject({ imageHash: "f".repeat(64), title: "Leer" });
  });
});

describe("validación de imágenes", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

  it("detecta el tipo real por la firma, no por la extensión", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPG)).toBe("image/jpeg");
    expect(sniffImageType(GIF)).toBeNull();
  });

  it("rechaza archivos vacíos, enormes o con otro formato", async () => {
    await expect(validateImageFile(new File([], "a.png"))).rejects.toBeInstanceOf(ImageValidationError);
    await expect(validateImageFile(new File([GIF], "trampa.png", { type: "image/png" }))).rejects.toThrow(/Formato no admitido/);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png");
    await expect(validateImageFile(big)).rejects.toThrow(/10 MB/);
    await expect(validateImageFile(new File([PNG], "ok.png"))).resolves.toMatchObject({ type: "image/png" });
  });

  it("dimensiones mínimas y máximas", () => {
    expect(() => checkDimensions(100, 100)).toThrow(/pequeña/);
    expect(() => checkDimensions(9000, 500)).toThrow(/grande/);
    expect(() => checkDimensions(1200, 800)).not.toThrow();
  });
});

describe("salida real de Tesseract (agenda móvil de Google Calendar)", () => {
  it("fecha partida en dos líneas («MIÉ» / «30») o pegada al título («JUE Gimnasio»)", async () => {
    const lines = (await import("@/test/ocr-agenda-mobile.json")).default as OcrLine[];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-30", view: "auto", imageWidth: 840 });
    expect(r.view).toBe("agenda");
    expect(r.events.map((e) => [e.title, e.date, e.startTime, e.endTime])).toEqual([
      ["Tomar agua", "2026-09-30", "10:00", "10:15"],
      ["Gimnasio", "2026-10-01", "06:00", "07:00"],
      ["Reunión de equipo", "2026-10-01", "15:00", "16:00"],
    ]);
  });

  it("título y hora del mismo bloque de color van juntos aunque haya otro texto cerca", () => {
    const lines: OcrLine[] = [
      { ...L("Leer", 186, 137), group: 0 },
      { ...L("8:00 — 8:30 p. m.", 186, 160), group: 0 },
      { ...L("Notas sueltas", 186, 118) }, // más cerca por arriba, pero fuera del bloque
    ];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-30", view: "day", imageWidth: 400 });
    expect(r.events[0]).toMatchObject({ title: "Leer", startTime: "20:00" });
  });

  it("«Tomar agua» se asocia a «Beber 2L de agua»; «Gimnasio» a «Ejercicio»", () => {
    const habits = [
      { id: "w", name: "Beber 2L de agua", archived: false },
      { id: "r", name: "Leer 20 min", archived: false },
      { id: "e", name: "Ejercicio", archived: false },
    ] as any;
    expect(matchHabits({ title: "Tomar agua", date: null, startTime: null }, habits)).toMatchObject({ kind: "match", habitId: "w" });
    expect(matchHabits({ title: "Gimnasio", date: null, startTime: null }, habits)).toMatchObject({ kind: "match", habitId: "e" });
    expect(matchHabits({ title: "Reunión de equipo", date: null, startTime: null }, habits).kind).toBe("none");
  });
});

describe("detección de bloques de color", () => {
  function canvas(w: number, h: number, rects: [number, number, number, number, [number, number, number]][]) {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const [x, y, rw, rh, [r, g, b]] of rects) {
      for (let yy = y; yy < y + rh; yy++)
        for (let xx = x; xx < x + rw; xx++) {
          const i = (yy * w + xx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
    }
    return { data, width: w, height: h };
  }

  it("encuentra cada evento aunque tenga texto blanco dentro y separa bloques contiguos", async () => {
    const { findChips, meanLuminance, normalizeChip } = await import("./chips");
    const px = canvas(300, 200, [
      [20, 20, 120, 40, [142, 36, 170]], // morado
      [22, 30, 60, 6, [255, 255, 255]], //  texto blanco dentro
      [20, 66, 120, 40, [3, 155, 229]], // azul, separado por 6 px en blanco
      [200, 20, 2, 150, [120, 120, 120]], // línea gris de la rejilla: no es un evento
    ]);
    const chips = findChips(px);
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject({ x0: 18, y0: 18 });
    expect(meanLuminance(px, chips[0])).toBeLessThan(150);
    // Fondo oscuro: tras normalizar, el texto blanco queda oscuro sobre fondo claro.
    normalizeChip(px, true);
    const at = (x: number, y: number) => px.data[(y * px.width + x) * 4];
    expect(at(30, 32)).toBeLessThan(50); // texto
    expect(at(100, 50)).toBeGreaterThan(200); // fondo
  });
});

describe("fusión de lecturas página + bloques", () => {
  it("conserva las palabras de fecha fuera del bloque y usa la lectura del bloque dentro", async () => {
    const { mergeChipLines } = await import("./chips");
    const page = (await import("@/test/ocr-agenda-mobile.json")).default as OcrLine[];
    // Bloque de "Gimnasio" tal como lo detecta findChips en esa captura.
    const chip = { x0: 176, y0: 380, x1: 410, y1: 470 };
    const chipLines: OcrLine[] = [
      { ...L("Gimnasio", 186, 392), group: 0 },
      { ...L("6:00 — 7:00 a. m.", 186, 426), group: 0 },
    ];
    const merged = mergeChipLines(page, chipLines, [chip]);
    const texts = merged.map((l) => l.text);
    expect(texts).toContain("JUE");
    expect(texts).toContain("1");
    expect(texts).not.toContain("JUE Gimnasio");
    const r = parseCalendarText(merged, { referenceDate: "2026-09-30", view: "auto", imageWidth: 840 });
    expect(r.events.find((e) => e.title === "Gimnasio")).toMatchObject({ date: "2026-10-01", startTime: "06:00" });
  });
});

describe("cabecera de semana mal leída por el OCR", () => {
  it("recupera «wie 30» y «vE2» porque el número visible coincide con la rejilla", async () => {
    const header = (await import("@/test/ocr-week-header.json")).default as OcrLine[];
    // Eventos en las columnas del miércoles (x≈546) y del viernes (x≈953), como los lee el OCR por bloque.
    const lines: OcrLine[] = [
      ...header,
      { ...L("Leer", 538, 572), group: 0 },
      { ...L("8:00 – 8:30 p. m.", 538, 586), group: 0 },
      { ...L("Ejercicio", 938, 92), group: 1 },
      { ...L("6:00 – 7:00 a. m.", 938, 106), group: 1 },
    ];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "auto", imageWidth: 1100 });
    expect(r.view).toBe("week");
    expect(r.events.map((e) => [e.title, e.date])).toEqual([
      ["Leer", "2026-09-30"],
      ["Ejercicio", "2026-10-02"],
    ]);
    expect(r.warnings.join(" ")).not.toMatch(/columnas no tienen fecha/);
  });

  it("no acepta una columna si el número visible no cuadra con la rejilla", () => {
    const lines = [L("LUN 28", 145, 47), L("MAR 29", 344, 47), L("xx 17", 546, 47), { ...L("Leer", 538, 300), group: 0 }, { ...L("8 – 9 p. m.", 538, 316), group: 0 }];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-28", view: "auto", imageWidth: 1100 });
    // Sin columna verificada para x≈546, se asigna a la más cercana (martes) y se avisa.
    expect(r.events[0].date).not.toBe("2026-09-30");
  });
});

describe("agenda: nombre del día ilegible", () => {
  it("«E» en vez de «JUE»: el número grande de la columna de fechas fecha el día (orden cronológico)", async () => {
    const lines = (await import("@/test/ocr-agenda-mobile-2x.json")).default as OcrLine[];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-30", view: "auto", imageWidth: 2000 });
    // (Solo lectura de página: el «E» residual del título lo elimina, en la app, la lectura por bloque.)
    expect(r.events.map((e) => [e.title.replace(/^E /, ""), e.date, e.startTime])).toEqual([
      ["Tomar agua", "2026-09-30", "10:00"],
      ["Gimnasio", "2026-10-01", "06:00"],
      ["Reunión de equipo", "2026-10-01", "15:00"],
    ]);
  });

  it("un número pequeño (p. ej. de una hora) no se toma por un día", () => {
    const lines = [L("MIÉ", 20, 100, 90, 30), { ...L("30", 20, 120, 90, 30), bbox: { x0: 20, y0: 120, x1: 50, y1: 150 } }, L("Leer", 120, 100), L("8:00 – 8:30 p. m.", 120, 120), L("5", 25, 300, 90, 8), L("Correr", 120, 300), L("9:00 – 10:00 a. m.", 120, 320)];
    lines[1].words = [{ text: "30", confidence: 90, bbox: { x0: 20, y0: 120, x1: 50, y1: 150 } }];
    const r = parseCalendarText(lines, { referenceDate: "2026-09-30", view: "agenda", imageWidth: 400 });
    expect(r.events.find((e) => e.title === "Correr")?.date).toBe("2026-09-30");
  });
});
