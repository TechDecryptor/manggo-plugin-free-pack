import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as plugin from "./main.js";

const metadata = JSON.parse(readFileSync(new URL("./manggo.plugin.json", import.meta.url), "utf8"));
const service = id => metadata.services.find(item => item.id === id);
const youdao = plugin[service("youdao").entry];

function youdaoFixture(word) {
  return {ec:{word:{trs:[{pos:"int.", tran:"你好"}], ...word}}};
}

test("Youdao preserves its stable service and declares the native dictionary capability", () => {
  assert.equal(service("youdao").providerId, "com.TechDecryptor.manggo.free-pack.youdao");
  assert.equal(service("youdao").resultType, "dictionary");
  assert.ok(metadata.requires.capabilities.includes("translation.pronunciationAudio"));
});

test("Youdao card contains separate real phonetics and compatible nested audio", async () => {
  let requestCount = 0;
  const result = await youdao("Hello","en","zh-CHS",{utils:{async fetch(url) {
    requestCount++;
    assert.equal(new URL(url).hostname, "dict.youdao.com");
    return Response.json(youdaoFixture({
      usphone:"/həˈloʊ/", ukphone:"həˈləʊ",
      usspeech:"hello&type=2&arbitrary=secret", ukspeech:"hello&type=1",
    }));
  }}});
  assert.equal(requestCount,1);
  assert.equal(result.kind,"dictionary");
  assert.ok(!Object.hasOwn(result.dictionary,"audioUrl"));
  assert.deepEqual(result.dictionary.pronunciations,[
    {label:"US",phonetic:"həˈloʊ",audio:{url:"https://dict.youdao.com/dictvoice?audio=hello&type=2",contentType:"audio/mpeg"}},
    {label:"UK",phonetic:"həˈləʊ",audio:{url:"https://dict.youdao.com/dictvoice?audio=hello&type=1",contentType:"audio/mpeg"}},
  ]);
  assert.equal(result.dictionary.meanings[0].translations[0],"你好");
});

test("Youdao never fabricates phonetic text and omits mismatched audio", async () => {
  const result = await youdao("hello","en","zh-CHS",{utils:{async fetch() {
    return Response.json(youdaoFixture({usphone:"",usspeech:"hello&type=2",ukphone:"/həˈləʊ/",ukspeech:"other&type=1"}));
  }}});
  assert.deepEqual(result.dictionary.pronunciations,[{label:"UK",phonetic:"həˈləʊ"}]);
});

test("Youdao ordinary text remains plain translation", async () => {
  const result = await youdao("hello there","en","zh-CHS",{utils:{async fetch() {
    return Response.json({fanyi:{tran:"你好啊"}});
  }}});
  assert.equal(result,"你好啊");
});

