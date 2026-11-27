import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRANSMART_URL = "https://transmart.qq.com/api/imt";
const TRANSMART_CLIENT_KEY =
  "browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487";
const TRANSMART_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Referer: "https://transmart.qq.com/zh-CN/index",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
};

const VOLCENGINE_URL = "https://translate.volcengine.com/crx/translate/v1/";

const YOUDAO_URL = "https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4";
const YOUDAO_KEY_FROM = "webdict";
const YOUDAO_CLIENT = "web";
const YOUDAO_SIGN_KEY = "Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu";
const YOUDAO_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.youdao.com",
  Referer: "https://www.youdao.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const GOOGLE_URL = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute";
const GOOGLE_TRANSLATE_RPC = "MkEWBc";

const BING_URL = "https://edge.microsoft.com/translate/translatetext";
const BING_EDGE_MAJOR_VERSION = "151";
const BING_EDGE_VERSION = "151.0.4129.59";
const BING_EDGE_USER_AGENT_VERSION = "151.0.0.0";
const BING_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  "Content-Type": "application/json",
  "Sec-CH-UA": `"Not=A?Brand";v="99", "Microsoft Edge";v="${BING_EDGE_MAJOR_VERSION}", "Chromium";v="${BING_EDGE_MAJOR_VERSION}"`,
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Mesh-Client-Arch": "x86_64",
  "Sec-Mesh-Client-Edge-Channel": "stable",
  "Sec-Mesh-Client-Edge-Version": BING_EDGE_VERSION,
  "Sec-Mesh-Client-OS": "Windows",
  "Sec-Mesh-Client-OS-Version": "10.0.26200",
  "Sec-Mesh-Client-WebView": "0",
  "User-Agent":
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BING_EDGE_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${BING_EDGE_USER_AGENT_VERSION}`,
  "X-Edge-Shopping-Flag": "0",
};

function textValue(value) {
  return String(value ?? "");
}

function trimmedValue(value) {
  return textValue(value).trim();
}

function runtimeFetch(options) {
  const fetch = options?.utils?.fetch;
  if (typeof fetch !== "function") {
    throw new Error("Manggo 插件运行时未提供网络请求能力。");
  }
  return fetch;
}

function shortMessage(value) {
  return trimmedValue(value).replace(/\s+/g, " ").slice(0, 300);
}

function payloadMessage(payload) {
  const candidates = [payload, payload?.error, payload?.header, payload?.data];
  const keys = ["message", "msg", "errorMsg", "error_msg", "ret_msg", "detail"];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const key of keys) {
      const message = shortMessage(candidate[key]);
      if (message) return message;
    }
  }
  return "";
}

async function responseText(response, serviceName) {
  try {
    return await response.text();
  } catch (error) {
    throw new Error(`${serviceName}响应读取失败：${shortMessage(error?.message || error)}`);
  }
}

async function jsonResponse(response, serviceName) {
  const raw = await responseText(response, serviceName);

  let payload;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      if (!response.ok) {
        throw new Error(
          `${serviceName}请求失败：HTTP ${response.status}${raw ? `，${shortMessage(raw)}` : ""}`,
        );
      }
      throw new Error(`${serviceName}返回了无法解析的响应。`);
    }
  }

  if (!response.ok) {
    const detail = payloadMessage(payload);
    throw new Error(
      `${serviceName}请求失败：HTTP ${response.status}${detail ? `，${detail}` : ""}`,
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`${serviceName}返回了空响应。`);
  }
  return payload;
}

function scalarCode(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function isSuccessfulTransmartCode(code) {
  return ["", "0", "succ", "success", "ok"].includes(code.toLowerCase());
}

function transmartError(payload) {
  const header = payload?.header || payload?.Header || {};
  const code = scalarCode(
    header.ret_code ?? header.retCode ?? payload?.ret_code ?? payload?.retCode,
  );
  if (isSuccessfulTransmartCode(code)) return "";
  const message = payloadMessage(payload);
  return message ? `${message}（错误码：${code}）` : `错误码 ${code}`;
}

function translationItems(value) {
  if (Array.isArray(value)) {
    return value.flatMap(translationItems);
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (!value || typeof value !== "object") return [];

  for (const key of ["text", "translation", "target", "tgt"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return [value[key].trim()];
    }
  }
  return [];
}

function transmartTranslations(payload) {
  const candidates = [
    payload?.auto_translation,
    payload?.data?.auto_translation,
    payload?.target?.text_list,
    payload?.translation,
  ];

  for (const candidate of candidates) {
    const translations = translationItems(candidate);
    if (translations.length > 0) return translations;
  }
  return [];
}

export async function translateTransmart(text, from, to, options) {
  const sourceText = textValue(text);
  if (!sourceText.trim()) return "";

  const sourceLanguage = trimmedValue(from) || "auto";
  const targetLanguage = trimmedValue(to);
  if (!targetLanguage || targetLanguage === "auto") {
    throw new Error("腾讯交互翻译需要明确的目标语言。");
  }

  const fetch = runtimeFetch(options);
  const response = await fetch(TRANSMART_URL, {
    method: "POST",
    headers: TRANSMART_HEADERS,
    body: JSON.stringify({
      header: {
        fn: "auto_translation",
        client_key: TRANSMART_CLIENT_KEY,
      },
      type: "plain",
      model_category: "normal",
      source: {
        lang: sourceLanguage,
        text_list: [sourceText],
      },
      target: {
        lang: targetLanguage,
      },
    }),
  });
  const payload = await jsonResponse(response, "腾讯交互翻译");
  const apiError = transmartError(payload);
  if (apiError) throw new Error(`腾讯交互翻译失败：${apiError}`);

  const translations = transmartTranslations(payload);
  if (translations.length === 0) {
    throw new Error("腾讯交互翻译未返回可用译文。");
  }
  return translations.join("\n").trim();
}

function volcengineError(payload) {
  const baseResponse = payload?.base_resp || payload?.baseResp;
  if (!baseResponse || typeof baseResponse !== "object") return "";

  const code = scalarCode(baseResponse.status_code ?? baseResponse.statusCode);
  if (!code || code === "0") return "";

  const message = shortMessage(
    baseResponse.status_message ?? baseResponse.statusMessage,
  ) || payloadMessage(payload);
  return message ? `${message}（错误码：${code}）` : `错误码 ${code}`;
}

export async function translateVolcengine(text, from, to, options) {
  const sourceText = textValue(text);
  if (!sourceText.trim()) return "";

  const requestedSourceLanguage = trimmedValue(from);
  const sourceLanguage = !requestedSourceLanguage || requestedSourceLanguage === "auto"
    ? "detect"
    : requestedSourceLanguage;
  const targetLanguage = trimmedValue(to);
  if (!targetLanguage || targetLanguage === "auto" || targetLanguage === "detect") {
    throw new Error("火山翻译需要明确的目标语言。");
  }

  const fetch = runtimeFetch(options);
  const response = await fetch(VOLCENGINE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_language: sourceLanguage,
      target_language: targetLanguage,
      text: sourceText,
    }),
  });
  const payload = await jsonResponse(response, "火山翻译");
  const apiError = volcengineError(payload);
  if (apiError) throw new Error(`火山翻译失败：${apiError}`);

  const translations = translationItems(payload.translation);
  if (translations.length === 0) {
    throw new Error("火山翻译未返回可用译文。");
  }
  return translations.join("\n").trim();
}

// Updated 2026-11-19 to use Google Translate's web RPC for translation.
function googleTranslatedText(raw, targetLanguage) {
  const separator = /^(zh|ja)(-|$)/i.test(targetLanguage) ? "" : " ";
  for (const line of raw.split("\n")) {
    // The response has a security prefix and line-delimited JSON batches.
    const batch = line.trim();
    if (!batch.startsWith("[[")) continue;
    const reply = JSON.parse(batch).find((entry) => (
      entry?.[0] === "wrb.fr" && entry[1] === GOOGLE_TRANSLATE_RPC
    ));
    if (typeof reply?.[2] !== "string") continue;
    const result = JSON.parse(reply[2])?.[1]?.[0]?.[0];
    const segments = result?.[5];
    if (!Array.isArray(segments)) return typeof result?.[0] === "string" ? result[0].trim() : "";

    let translatedText = "";
    for (const segment of segments) {
      const text = segment?.[0];
      if (typeof text !== "string" || !text) continue;
      if (translatedText && !/\s$/.test(translatedText) && !/^\s/.test(text)) translatedText += separator;
      translatedText += text;
    }
    return translatedText.trim();
  }
  return "";
}

export async function translateGoogle(text, from, to, options) {
  const sourceText = textValue(text);
  if (!sourceText.trim()) return "";

  const targetLanguage = trimmedValue(to);
  if (!targetLanguage || targetLanguage === "auto") {
    throw new Error("Google 翻译需要明确的目标语言。");
  }

  const url = new URL(GOOGLE_URL);
  url.searchParams.set("rpcids", GOOGLE_TRANSLATE_RPC);
  url.searchParams.set("hl", "en");
  url.searchParams.set("rt", "c");
  const sourceLanguage = trimmedValue(from) || "auto";
  const translation = JSON.stringify([[sourceText, sourceLanguage, targetLanguage, true], [null]]);
  const request = JSON.stringify([[[GOOGLE_TRANSLATE_RPC, translation, null, "generic"]]]);
  const fetch = runtimeFetch(options);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ "f.req": request }).toString(),
  });
  if (response.status === 429) {
    throw new Error("Google 翻译请求被限流（HTTP 429），请稍后再试。");
  }
  if (!response.ok) throw new Error(`Google 翻译请求失败（HTTP ${response.status}）。`);

  const raw = await responseText(response, "Google 翻译");
  let translatedText;
  try {
    translatedText = googleTranslatedText(raw, targetLanguage);
  } catch (_) {
    throw new Error("Google 翻译返回了无法解析的响应。");
  }
  if (!translatedText) throw new Error("Google 翻译未返回可用译文。");
  return translatedText;
}

function bingTranslateUrl(from, to) {
  const url = new URL(BING_URL);
  const sourceLanguage = trimmedValue(from) || "auto";
  if (sourceLanguage !== "auto") url.searchParams.set("from", sourceLanguage);
  url.searchParams.set("to", to);
  url.searchParams.set("isEnterpriseClient", "false");
  return url.toString();
}

function bingError(payload) {
  const error = payload?.error;
  if (!error || typeof error !== "object") return "";

  const code = scalarCode(error.code);
  const message = shortMessage(error.message);
  if (code && message) return `${message}（错误码：${code}）`;
  return message || (code ? `错误码 ${code}` : "Bing 翻译返回了未知错误。");
}

function bingTranslatedText(payload) {
  const translation = Array.isArray(payload)
    ? payload[0]?.translations?.[0]?.text
    : null;
  return typeof translation === "string" ? translation.trim() : "";
}

export async function translateBing(text, from, to, options) {
  const sourceText = textValue(text);
  if (!sourceText.trim()) return "";

  const targetLanguage = trimmedValue(to);
  if (!targetLanguage || targetLanguage === "auto") {
    throw new Error("Bing 翻译需要明确的目标语言。");
  }

  const fetch = runtimeFetch(options);
  const response = await fetch(bingTranslateUrl(from, targetLanguage), {
    method: "POST",
    headers: BING_HEADERS,
    body: JSON.stringify([sourceText]),
  });
  const payload = await jsonResponse(response, "Bing 翻译");
  const apiError = bingError(payload);
  if (apiError) throw new Error(`Bing 翻译失败：${apiError}`);

  const translatedText = bingTranslatedText(payload);
  if (!translatedText) {
    throw new Error("Bing 翻译未返回可用译文。");
  }
  return translatedText;
}

function md5Hex(value) {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function youdaoSignature(text) {
  const time = `${text}${YOUDAO_KEY_FROM}`.length % 10;
  const firstHash = md5Hex(`${text}${YOUDAO_KEY_FROM}`);
  const sign = md5Hex(
    `${YOUDAO_CLIENT}${text}${time}${YOUDAO_SIGN_KEY}${firstHash}`,
  );
  return { sign, time };
}

function normalizedLanguage(language) {
  return trimmedValue(language).toLowerCase().replaceAll("_", "-");
}

function youdaoLookupLanguage(language) {
  const normalized = normalizedLanguage(language);
  if (!normalized || normalized === "auto") return "auto";
  if (["zh", "zh-cn", "zh-tw", "zh-chs", "zh-cht", "zh-hans", "zh-hant"].includes(normalized)) {
    return "zh";
  }

  const aliases = {
    "en-us": "en",
    "ja-jp": "ja",
    "ko-kr": "ko",
    "fr-fr": "fr",
    "de-de": "de",
    "es-es": "es",
    "ru-ru": "ru",
    "pt-pt": "pt",
    "pt-br": "pt",
  };
  const code = aliases[normalized] || normalized;
  return ["en", "ja", "ko", "fr", "de", "es", "ru", "pt"].includes(code)
    ? code
    : "";
}

function inferYoudaoLanguage(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[a-z]/iu.test(text)) return "en";
  return "";
}

function resolveYoudaoLanguage(text, from, to, options) {
  const normalizedSource = normalizedLanguage(from) || "auto";
  const normalizedTarget = normalizedLanguage(to) || "auto";
  const source = youdaoLookupLanguage(normalizedSource);
  const target = youdaoLookupLanguage(normalizedTarget);

  if (normalizedTarget !== "auto" && !target) {
    throw new Error(`有道翻译不支持目标语言：${to}`);
  }

  // Manggo may pass the detected language as `from` for an automatic-source
  // request. An unmapped source therefore remains an automatic lookup instead
  // of failing before Youdao gets a chance to detect the query itself.
  const automaticSource = normalizedSource === "auto" || !source;
  const detected = automaticSource ? youdaoLookupLanguage(options?.detect) : source;
  const inferredSource = automaticSource
    ? (detected && detected !== "auto" ? detected : inferYoudaoLanguage(text))
    : source;
  const resolvedTarget = target === "auto" ? "" : target;

  if (
    inferredSource &&
    resolvedTarget &&
    inferredSource !== "zh" &&
    resolvedTarget !== "zh" &&
    inferredSource !== resolvedTarget
  ) {
    throw new Error(`有道网页接口暂不支持 ${from || "auto"} 到 ${to || "auto"} 的翻译。`);
  }
  if (inferredSource === "zh" && resolvedTarget && resolvedTarget !== "zh") {
    return resolvedTarget;
  }
  if (
    inferredSource &&
    inferredSource !== "zh" &&
    (!resolvedTarget || resolvedTarget === "zh" || resolvedTarget === inferredSource)
  ) {
    return inferredSource;
  }
  if (resolvedTarget && resolvedTarget !== "zh") return resolvedTarget;
  if (resolvedTarget === "zh" && inferredSource && inferredSource !== "zh") {
    return inferredSource;
  }
  if (inferredSource && inferredSource !== "auto") return inferredSource;
  return "en";
}

function stringsFrom(value) {
  if (Array.isArray(value)) return value.flatMap(stringsFrom);
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (!value || typeof value !== "object") return [];
  for (const key of ["#text", "value", "text", "translation"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return [value[key].trim()];
    }
  }
  return [];
}

function youdaoWebTranslations(webTranslation) {
  if (Array.isArray(webTranslation)) return stringsFrom(webTranslation);
  const entries = webTranslation?.["web-translation"];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => stringsFrom(entry?.trans));
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = trimmedValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function splitYoudaoTranslations(value) {
  return uniqueStrings(
    stringsFrom(value)
      .flatMap((text) => text.split(/[；;]/u))
      .map((text) => text.trim()),
  );
}

function manggoDictionaryLanguage(language, text) {
  const normalized = normalizedLanguage(language);
  const aliases = {
    en: "en_US",
    "en-us": "en_US",
    zh: "zh_CN",
    "zh-cn": "zh_CN",
    "zh-chs": "zh_CN",
    "zh-hans": "zh_CN",
    "zh-tw": "zh_TW",
    "zh-cht": "zh_TW",
    "zh-hant": "zh_TW",
    ja: "ja_JP",
    "ja-jp": "ja_JP",
    ko: "ko_KR",
    "ko-kr": "ko_KR",
    fr: "fr_FR",
    "fr-fr": "fr_FR",
    vi: "vi_VN",
    "vi-vn": "vi_VN",
    de: "de_DE",
    "de-de": "de_DE",
    it: "it_IT",
    "it-it": "it_IT",
    ru: "ru_RU",
    "ru-ru": "ru_RU",
    uk: "uk_UA",
    "uk-ua": "uk_UA",
  };
  if (aliases[normalized]) return aliases[normalized];

  const inferred = inferYoudaoLanguage(text);
  return aliases[inferred] || "";
}

function dictionarySourceLanguage(text, from, options) {
  const source = normalizedLanguage(from);
  if (source && source !== "auto") return manggoDictionaryLanguage(source, text);

  const detected = normalizedLanguage(options?.detect);
  if (detected && detected !== "auto") return manggoDictionaryLanguage(detected, text);
  return manggoDictionaryLanguage("", text);
}

function youdaoAudioUrl(value) {
  const speech = trimmedValue(value);
  if (!speech) return "";

  const [audio, ...extraParts] = speech.split("&");
  if (!audio) return "";
  const url = new URL("https://dict.youdao.com/dictvoice");
  url.searchParams.set("audio", audio);
  for (const part of extraParts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const parameterValue = part.slice(separator + 1).trim();
    if (key === "type" && parameterValue) {
      url.searchParams.set(key, parameterValue);
    }
  }
  return url.toString();
}

function youdaoPronunciations(word) {
  const definitions = [
    { label: "US", phone: word?.usphone, speech: word?.usspeech },
    { label: "UK", phone: word?.ukphone, speech: word?.ukspeech },
  ];

  return definitions.flatMap(({ label, phone, speech }) => {
    const phonetic = trimmedValue(phone).replace(/^\/(.*)\/$/u, "$1");
    const audioUrl = youdaoAudioUrl(speech);
    if (!phonetic && !audioUrl) return [];
    return [{
      label,
      ...(phonetic ? { phonetic } : {}),
      ...(audioUrl ? { audioUrl } : {}),
    }];
  });
}

function normalizedPartOfSpeech(value) {
  return trimmedValue(value).toLowerCase().replace(/[.\s]+/gu, "");
}

function youdaoExamples(payload) {
  const examples = [];
  const collinsEntries = payload?.collins?.collins_entries;
  for (const collinsEntry of Array.isArray(collinsEntries) ? collinsEntries : []) {
    const entries = collinsEntry?.entries?.entry;
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const translation of Array.isArray(entry?.tran_entry) ? entry.tran_entry : []) {
        const sentences = translation?.exam_sents?.sent;
        for (const sentence of Array.isArray(sentences) ? sentences : []) {
          const source = trimmedValue(sentence?.eng_sent);
          const target = trimmedValue(sentence?.chn_sent);
          if (source || target) examples.push([source, target].filter(Boolean).join(" — "));
        }
      }
    }
  }
  return uniqueStrings(examples).slice(0, 10);
}

function youdaoMeanings(payload) {
  const entries = payload?.ec?.word?.trs;
  const meanings = (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const translations = splitYoudaoTranslations(entry?.tran);
    if (translations.length === 0) return [];
    const partOfSpeech = trimmedValue(entry?.pos);
    return [{
      ...(partOfSpeech ? { partOfSpeech } : {}),
      translations,
    }];
  });

  const synonymGroups = payload?.syno?.synos;
  for (const group of Array.isArray(synonymGroups) ? synonymGroups : []) {
    const synonyms = uniqueStrings(
      (Array.isArray(group?.ws) ? group.ws : []).map((item) => item?.w),
    );
    if (synonyms.length === 0) continue;

    const partOfSpeech = trimmedValue(group?.pos);
    const normalized = normalizedPartOfSpeech(partOfSpeech);
    const matching = meanings.find(
      (meaning) => normalized && normalizedPartOfSpeech(meaning.partOfSpeech) === normalized,
    );
    if (matching) {
      matching.synonyms = uniqueStrings([...(matching.synonyms || []), ...synonyms]);
    } else {
      meanings.push({
        ...(partOfSpeech ? { partOfSpeech } : {}),
        synonyms,
      });
    }
  }

  const examples = youdaoExamples(payload);
  if (examples.length > 0) {
    if (meanings.length > 0) meanings[0].examples = examples;
    else meanings.push({ examples });
  }

  const existingTranslations = new Set(
    meanings.flatMap((meaning) => meaning.translations || []),
  );
  const webTranslations = uniqueStrings([
    ...youdaoWebTranslations(payload?.ec?.web_trans),
    ...youdaoWebTranslations(payload?.web_trans),
  ]).filter((translation) => !existingTranslations.has(translation));
  if (webTranslations.length > 0) {
    meanings.push({
      partOfSpeech: "网络释义",
      translations: webTranslations.slice(0, 5),
    });
  }

  return meanings;
}

function stableFormType(value) {
  const name = trimmedValue(value);
  const normalized = name.toLowerCase().replace(/[\s_-]+/gu, "");
  const aliases = {
    复数: "plural",
    复数形式: "plural",
    过去式: "past",
    过去分词: "past_participle",
    现在分词: "present_participle",
    第三人称单数: "third_person_singular",
    第三人称单数形式: "third_person_singular",
    比较级: "comparative",
    最高级: "superlative",
    原形: "lemma",
    原级: "lemma",
    plural: "plural",
    past: "past",
    pasttense: "past",
    pastparticiple: "past_participle",
    presentparticiple: "present_participle",
    thirdpersonsingular: "third_person_singular",
    comparative: "comparative",
    superlative: "superlative",
    lemma: "lemma",
  };
  return aliases[normalized] || name || "variant";
}

function youdaoForms(word) {
  const forms = [];
  const seen = new Set();
  for (const item of Array.isArray(word?.wfs) ? word.wfs : []) {
    const formWord = trimmedValue(item?.wf?.value);
    if (!formWord) continue;
    const type = stableFormType(item?.wf?.name);
    const identity = `${type}\u0000${formWord}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    forms.push({ type, word: formWord });
  }
  return forms;
}

function youdaoProperties(payload) {
  const properties = [{ key: "source", label: "来源", value: "有道词典" }];

  const phrases = [];
  const phraseEntries = payload?.phrs?.phrs;
  for (const phrase of (Array.isArray(phraseEntries) ? phraseEntries : []).slice(0, 5)) {
    const headword = trimmedValue(phrase?.headword);
    const translations = stringsFrom(phrase?.translation);
    if (headword && translations.length > 0) {
      phrases.push(`${headword}：${translations.join("；")}`);
    }
  }
  if (phrases.length > 0) {
    properties.push({ key: "phrases", label: "常用词组", value: phrases.join("\n") });
  }

  const relatedWords = [];
  const relatedEntries = payload?.rel_word?.rels;
  for (const entry of Array.isArray(relatedEntries) ? relatedEntries : []) {
    const relation = entry?.rel;
    const words = uniqueStrings(
      (Array.isArray(relation?.words) ? relation.words : []).map((item) => {
        const word = trimmedValue(item?.word);
        const translation = trimmedValue(item?.tran);
        return word ? `${word}${translation ? `（${translation}）` : ""}` : "";
      }),
    );
    if (words.length === 0) continue;
    const partOfSpeech = trimmedValue(relation?.pos);
    relatedWords.push(`${partOfSpeech ? `${partOfSpeech} ` : ""}${words.join("、")}`);
  }
  if (relatedWords.length > 0) {
    properties.push({
      key: "related_words",
      label: "相关词",
      value: relatedWords.join("\n"),
    });
  }
  return properties;
}

function youdaoDictionaryResult(payload, sourceText, from, options) {
  const word = payload?.ec?.word;
  if (!word || !Array.isArray(word.trs) || word.trs.length === 0) return null;

  const pronunciations = youdaoPronunciations(word);
  const meanings = youdaoMeanings(payload);
  const tags = uniqueStrings(stringsFrom(payload?.ec?.exam_type));
  const forms = youdaoForms(word);
  const properties = youdaoProperties(payload);
  const language = dictionarySourceLanguage(sourceText, from, options);
  const audioUrl = pronunciations.find((item) => item.label === "US" && item.audioUrl)?.audioUrl
    || pronunciations.find((item) => item.audioUrl)?.audioUrl
    || "";

  return {
    kind: "dictionary",
    dictionary: {
      word: sourceText.trim(),
      ...(language ? { language } : {}),
      ...(pronunciations.length > 0 ? { pronunciations } : {}),
      ...(meanings.length > 0 ? { meanings } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(forms.length > 0 ? { forms } : {}),
      ...(properties.length > 0 ? { properties } : {}),
      ...(audioUrl ? { audioUrl } : {}),
    },
  };
}

function youdaoTranslations(payload) {
  const sentenceTranslations = stringsFrom(payload?.fanyi?.tran);
  if (sentenceTranslations.length > 0) return sentenceTranslations;

  const chineseTranslations = stringsFrom(payload?.ce?.word?.trs);
  if (chineseTranslations.length > 0) return chineseTranslations;

  const webTranslations = [
    ...youdaoWebTranslations(payload?.ec?.web_trans),
    ...youdaoWebTranslations(payload?.web_trans),
  ];
  return webTranslations.slice(0, 5);
}

function youdaoError(payload) {
  const code = scalarCode(payload?.errorCode ?? payload?.error_code);
  if (!code || code === "0") return "";
  const message = payloadMessage(payload);
  return message ? `${message}（错误码：${code}）` : `错误码 ${code}`;
}

export async function translateYoudao(text, from, to, options) {
  const sourceText = textValue(text);
  if (!sourceText.trim()) return "";

  const lookupLanguage = resolveYoudaoLanguage(sourceText, from, to, options);
  const { sign, time } = youdaoSignature(sourceText);
  const url = new URL(YOUDAO_URL);
  url.searchParams.set("q", sourceText);
  url.searchParams.set("keyfrom", YOUDAO_KEY_FROM);
  url.searchParams.set("sign", sign);
  url.searchParams.set("client", YOUDAO_CLIENT);
  url.searchParams.set("t", String(time));
  url.searchParams.set("le", lookupLanguage);

  const fetch = runtimeFetch(options);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: YOUDAO_HEADERS,
  });
  const payload = await jsonResponse(response, "有道翻译");
  const apiError = youdaoError(payload);
  if (apiError) throw new Error(`有道翻译失败：${apiError}`);

  const dictionaryResult = youdaoDictionaryResult(payload, sourceText, from, options);
  if (dictionaryResult) return dictionaryResult;

  const translations = youdaoTranslations(payload);
  if (translations.length === 0) {
    throw new Error("有道翻译未返回可用译文。");
  }
  return translations.join("\n").trim();
}

const BASE_URL = "https://web.baimiaoapp.com";
const SESSION_FILE = "baimiao-session.json";
const SESSION_VERSION = 1;
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 60_000;
const pendingSessions = new Map();

const BASE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "Content-Type": "application/json",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function authHeaders(session) {
  return {
    ...BASE_HEADERS,
    "X-Auth-Uuid": session.uuid,
    "X-Auth-Token": session.token,
  };
}

function detailMessage(payload) {
  for (const candidate of [payload, payload?.data, payload?.error, payload?.data?.ydResp]) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const key of ["message", "msg", "errorMsg", "error_msg", "detail"]) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim().replace(/\s+/gu, " ").slice(0, 200);
      }
    }
  }
  return "";
}

async function requestJson(fetch, path, init, action) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    const error = new Error(`白描 OCR ${action}失败：HTTP ${response.status}，响应不是 JSON。`);
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const detail = detailMessage(payload);
    const error = new Error(
      `白描 OCR ${action}失败：HTTP ${response.status}${detail ? `，${detail}` : ""}。`,
    );
    error.status = response.status;
    throw error;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`白描 OCR ${action}失败：响应为空。`);
  }
  return payload;
}

function accountKey(username) {
  return createHash("sha256").update(username.toLowerCase(), "utf8").digest("hex");
}

async function readSession(path, account) {
  try {
    const cached = JSON.parse(await readFile(path, "utf8"));
    if (
      cached?.version === SESSION_VERSION &&
      cached.account === account &&
      typeof cached.uuid === "string" && cached.uuid &&
      typeof cached.token === "string" && cached.token
    ) {
      return cached;
    }
  } catch (_) {
    // A missing or damaged cache is a normal cache miss.
  }
  return null;
}

async function saveSession(cacheDir, session) {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, SESSION_FILE);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(session)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    try {
      await chmod(path, 0o600);
    } catch (_) {
      // Windows does not support Unix file modes.
    }
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function login(fetch, cacheDir, account, username, password) {
  const session = { version: SESSION_VERSION, account, uuid: randomUUID(), token: "" };
  const payload = await requestJson(fetch, "/api/user/login", {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({
      username,
      password,
      type: username.includes("@") ? "email" : "mobile",
    }),
  }, "登录");
  const token = payload?.data?.token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`白描 OCR 登录失败：${detailMessage(payload) || "未返回登录令牌"}。`);
  }
  session.token = token.trim();
  await saveSession(cacheDir, session);
  return session;
}

async function refreshSession(fetch, cacheDir, session) {
  let payload;
  try {
    payload = await requestJson(fetch, "/api/user/login/anonymous", {
      method: "POST",
      headers: authHeaders(session),
    }, "验证登录");
  } catch (error) {
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
  const token = payload?.data?.token;
  if (typeof token !== "string" || !token.trim()) return null;
  if (token !== session.token) {
    session = { ...session, token: token.trim() };
    await saveSession(cacheDir, session);
  }
  return session;
}

async function getSession(fetch, cacheDir, username, password) {
  const account = accountKey(username);
  const path = join(cacheDir, SESSION_FILE);
  const key = `${path}:${account}`;
  const existing = pendingSessions.get(key);
  if (existing) return await existing;

  const request = (async () => {
    const cached = await readSession(path, account);
    if (cached) {
      const refreshed = await refreshSession(fetch, cacheDir, cached);
      if (refreshed) return refreshed;
    }
    return await login(fetch, cacheDir, account, username, password);
  })();
  pendingSessions.set(key, request);
  try {
    return await request;
  } finally {
    if (pendingSessions.get(key) === request) pendingSessions.delete(key);
  }
}

async function requestPermission(fetch, session) {
  const payload = await requestJson(fetch, "/api/perm/single", {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ mode: "single", version: "v2" }),
  }, "获取识别权限");
  const { engine, token } = payload?.data || {};
  if (typeof engine !== "string" || !engine || typeof token !== "string" || !token) {
    throw new Error(`白描 OCR 获取识别权限失败：${detailMessage(payload) || "今日识别次数可能已用完"}。`);
  }
  return { engine, token };
}

function baimiaoImage(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { bytes, mimeType: "image/png", extension: "png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes, mimeType: "image/jpeg", extension: "jpeg" };
  }
  if (bytes.toString("ascii", 0, 4) === "GIF8") {
    return { bytes, mimeType: "image/gif", extension: "gif" };
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { bytes, mimeType: "image/webp", extension: "webp" };
  }
  throw new Error("白描 OCR 不支持此图片格式。");
}

async function uploadBaimiaoImage(fetch, session, image) {
  const signPayload = await requestJson(
    fetch,
    `/api/oss/sign?mime_type=${encodeURIComponent(image.mimeType)}`,
    { method: "GET", headers: authHeaders(session) },
    "获取上传凭证",
  );
  const signed = signPayload?.data?.result;
  const fields = {
    key: signed?.file_key,
    policy: signed?.policy,
    "x-oss-signature": signed?.signature,
    "x-oss-signature-version": signed?.x_oss_signature_version,
    "x-oss-credential": signed?.x_oss_credential,
    "x-oss-date": signed?.x_oss_date,
    "x-oss-security-token": signed?.security_token,
    success_action_status: "200",
  };
  if (
    signPayload?.code !== 1 ||
    Object.values(fields).some((value) => typeof value !== "string" || !value)
  ) {
    throw new Error(`白描 OCR 获取上传凭证失败：${detailMessage(signPayload) || "凭证不完整"}。`);
  }
  let host;
  try {
    host = new URL(signed.host);
  } catch (_) {
    throw new Error("白描 OCR 返回了无效的图片上传地址。");
  }
  if (host.protocol !== "https:") {
    throw new Error("白描 OCR 返回了不安全的图片上传地址。");
  }

  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", new Blob([image.bytes], { type: image.mimeType }), `image.${image.extension}`);
  const response = await fetch(host.toString(), {
    method: "POST",
    headers: { Origin: BASE_URL, Referer: `${BASE_URL}/` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`白描 OCR 上传图片失败：HTTP ${response.status}。`);
  }
  return signed.file_key;
}

async function submitImage(fetch, session, permission, image, fileKey) {
  const hash = createHash("md5").update(image.bytes).digest("hex");
  const path = `/api/ocr/image/${encodeURIComponent(permission.engine)}`;
  const payload = await requestJson(fetch, path, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({
      token: permission.token,
      hash,
      name: `manggo_screenshot.${image.extension}`,
      size: image.bytes.length,
      createdAt: new Date().toISOString(),
      fileKey,
      result: {},
      status: "processing",
      isSuccess: false,
    }),
  }, "提交图片");
  const jobStatusId = payload?.data?.jobStatusId;
  if (jobStatusId === undefined || jobStatusId === null || jobStatusId === "") {
    throw new Error(`白描 OCR 提交图片失败：${detailMessage(payload) || "未返回任务 ID"}。`);
  }
  return String(jobStatusId);
}

async function pollResult(fetch, session, engine, jobStatusId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const path = `/api/ocr/image/${encodeURIComponent(engine)}/status?jobStatusId=${encodeURIComponent(jobStatusId)}`;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const payload = await requestJson(fetch, path, {
      method: "GET",
      headers: authHeaders(session),
    }, "查询识别结果");
    const data = payload?.data;
    if (!data?.isEnded) continue;

    const words = data?.ydResp?.words_result;
    if (!Array.isArray(words)) {
      throw new Error(`白描 OCR 识别失败：${detailMessage(payload) || "未返回识别文字"}。`);
    }
    return words
      .map((item) => item?.words)
      .filter((word) => typeof word === "string" && word.length > 0)
      .join("\n");
  }
  throw new Error("白描 OCR 识别超时，请稍后重试。");
}

export async function recognizeBaimiao(base64, _language, options) {
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new Error("白描 OCR 需要 PNG 图片的 Base64 内容。");
  }
  const fetch = options?.utils?.fetch;
  if (typeof fetch !== "function") {
    throw new Error("Manggo 插件运行时未提供网络请求能力。");
  }
  const cacheDir = String(options?.utils?.cacheDir || "").trim();
  if (!cacheDir) {
    throw new Error("Manggo 插件运行时未提供白描会话缓存目录。");
  }
  const username = String(options?.config?.username || "").trim();
  const password = String(options?.config?.password || "");
  if (!username || !password.trim()) {
    throw new Error("请先在白描 OCR 服务配置中填写手机号或邮箱及密码。");
  }

  let session = await getSession(fetch, cacheDir, username, password);
  let permission;
  try {
    permission = await requestPermission(fetch, session);
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) throw error;
    session = await login(fetch, cacheDir, accountKey(username), username, password);
    permission = await requestPermission(fetch, session);
  }
  const image = baimiaoImage(base64);
  const fileKey = await uploadBaimiaoImage(fetch, session, image);
  const jobStatusId = await submitImage(fetch, session, permission, image, fileKey);
  return await pollResult(fetch, session, permission.engine, jobStatusId);
}

export default {
  translateTransmart,
  translateVolcengine,
  translateYoudao,
  translateBing,
  translateGoogle,
  recognizeBaimiao,
};
