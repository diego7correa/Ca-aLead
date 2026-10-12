const assert = require("assert");
const Parser = require("../content/parser.js");

function sampleDarray() {
  const darray = [];
  darray[4] = [null, null, null, null, null, null, null, 4.8, 24];
  darray[7] = ["/url?q=https%3A%2F%2Fexemplo.com.br%2Fcontato&opi=1", "exemplo.com.br"];
  darray[11] = "Barbearia do Christian";
  darray[13] = ["Barbearia"];
  darray[18] = "Av. Manoel de Souza, 510 - Pedreirinha, Marituba - PA, 67203-605";
  darray[178] = [["(91) 98309-4166"]];
  darray[203] = [[
    ["segunda-feira", null, null, [["09:00–18:00"]]],
    ["domingo", null, null, [["Fechado"]]],
  ]];
  return darray;
}

const preview = `)]}'\n${JSON.stringify(Object.assign([], { 6: sampleDarray() }))}`;
const parsed = Parser.parsePlaceDocument(preview, "https://www.google.com");
assert.ok(parsed.place, "deveria ler a ficha do preview");
assert.strictEqual(parsed.place.nome, "Barbearia do Christian");
assert.strictEqual(parsed.place.telefone, "(91) 98309-4166");
assert.strictEqual(parsed.place.site, "https://exemplo.com.br/contato");
assert.strictEqual(parsed.place.endereco, "Av. Manoel de Souza, 510 - Pedreirinha, Marituba - PA, 67203-605");
assert.ok(parsed.place.horario.includes("segunda-feira: 09:00–18:00"));
assert.ok(parsed.place.horario.includes("domingo: Fechado"));
assert.strictEqual(parsed.place.avaliacao, "4,8 (24)");
assert.strictEqual(parsed.place.categoria, "Barbearia");

const oldHours = [];
oldHours[11] = "Clube da Barbearia";
oldHours[18] = "R. Júlia Cordeiro, 371 - Centro";
oldHours[34] = [null, [["terça-feira", ["08:00–12:00", "14:00–18:00"]]]];
oldHours[7] = ["https://instagram.com/clube"];
const oldPayload = [];
oldPayload[6] = oldHours;
const oldParsed = Parser.parsePlaceDocument(JSON.stringify(oldPayload));
assert.strictEqual(oldParsed.place.horario, "terça-feira: 08:00–12:00, 14:00–18:00");
assert.strictEqual(oldParsed.place.site, "https://instagram.com/clube");

const html = `<html><head><link href="/maps/preview/place?authuser=0&amp;hl=pt-BR&amp;q=Barbearia&amp;pb=!1m2"></head>
<script>window.APP_INITIALIZATION_STATE=${JSON.stringify([null, null, null, `)]}'\n${JSON.stringify(Object.assign([], { 6: sampleDarray() }))}`])};</script></html>`;
const fromHtml = Parser.parsePlaceDocument(html, "https://www.google.com");
assert.strictEqual(fromHtml.place.telefone, "(91) 98309-4166");
assert.ok(fromHtml.previewUrl.includes("/maps/preview/place?"));
assert.ok(fromHtml.previewUrl.includes("hl=pt-BR"));
assert.ok(!fromHtml.previewUrl.includes("amp;"));

const fallback = Parser.fallbackContacts('["(91) 98000-1122","/url?q=https%3A%2F%2Fbarbearia.exemplo%2F&opi=1"]');
assert.strictEqual(fallback.telefone, "(91) 98000-1122");
assert.strictEqual(fallback.site, "https://barbearia.exemplo/");

assert.strictEqual(Parser.cleanWebsite("https://www.google.com/maps/place/foo"), "");
assert.strictEqual(Parser.cleanWebsite("/url?q=https://sites.google.com/view/barbearia"), "https://sites.google.com/view/barbearia");

const card = Parser.parseCardText(
  "Barbearia do Christian",
  `Barbearia do Christian
5,0(1)
Barbearia · R. Rosineide Souza
Aberto · Fecha 17:00
"Excelente barbeiro"`
);
assert.strictEqual(card.avaliacao, "5,0 (1)");
assert.strictEqual(card.categoria, "Barbearia");
assert.strictEqual(card.endereco, "R. Rosineide Souza");
assert.strictEqual(card.horario, "Aberto · Fecha 17:00");

const key = Parser.placeKey("https://www.google.com/maps/place/Barbearia+Gold/data=!4m6!3m5!1s0x92a4:0x11ab");
assert.strictEqual(key, "0x92a4:0x11ab");

const csv = Parser.toCsv([
  {
    nome: 'Barbearia "A"',
    link: "https://maps.example/a",
    endereco: "Rua A; 10",
    horario: "segunda: 09:00",
    telefone: "(91) 98309-4166",
    site: "https://exemplo.com",
    avaliacao: "5,0 (1)",
    categoria: "Barbearia",
  },
]);
assert.ok(csv.charCodeAt(0) === 0xfeff);
assert.ok(csv.includes('"Barbearia ""A"""'));
assert.ok(csv.includes('"Rua A; 10"'));

console.log("parser ok");
