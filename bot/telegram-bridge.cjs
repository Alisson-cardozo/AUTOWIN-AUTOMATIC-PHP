/**
 * Bridge GramJS (mesmo fluxo do auto-autowin route.ts).
 * PHP envia JSON via stdin e recebe JSON em stdout.
 *
 * Ações: send-code | verify-code | search-groups | fetch-messages
 */
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PENDING_DIR = path.join(ROOT, "storage", "telegram-pending");

function ensurePendingDir() {
  if (!fs.existsSync(PENDING_DIR)) {
    fs.mkdirSync(PENDING_DIR, { recursive: true });
  }
}

function pendingPath(userId) {
  return path.join(PENDING_DIR, `${userId}.json`);
}

function readPending(userId) {
  const p = pendingPath(userId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writePending(userId, data) {
  ensurePendingDir();
  fs.writeFileSync(pendingPath(userId), JSON.stringify(data), "utf8");
}

function clearPending(userId) {
  const p = pendingPath(userId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function ok(payload = {}) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }));
}

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }));
  process.exitCode = 0;
}

function makeClient(sessionStr, apiId, apiHash) {
  const client = new TelegramClient(new StringSession(sessionStr || ""), apiId, apiHash, {
    connectionRetries: 3,
    useWSS: false,
  });
  // Evita logs no stdout que quebram o JSON lido pelo PHP
  if (typeof client.setLogLevel === "function") {
    client.setLogLevel("none");
  }
  return client;
}

async function withClient(sessionStr, apiId, apiHash, fn) {
  const client = makeClient(sessionStr, apiId, apiHash);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

async function handleSendCode(input) {
  const { userId, phone, apiId, apiHash } = input;
  if (!phone) throw new Error("Telefone obrigatório");
  if (!apiId || !apiHash) {
    throw new Error(
      "Credenciais Telegram não configuradas no painel admin (Sistema → API ID / API Hash)."
    );
  }

  const client = makeClient("", apiId, apiHash);
  await client.connect();
  try {
    const result = await client.sendCode({ apiId, apiHash }, phone);
    const session = client.session.save();
    writePending(userId, {
      phone,
      phoneCodeHash: result.phoneCodeHash,
      session: typeof session === "string" ? session : String(session),
      createdAt: Date.now(),
    });
    return { success: true };
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

async function handleVerifyCode(input) {
  const { userId, code, apiId, apiHash } = input;
  if (!code) throw new Error("Código obrigatório");

  const pending = readPending(userId);
  if (!pending) throw new Error("Sessão expirada. Reenvie o código.");

  const { phone, phoneCodeHash, session: partialSession } = pending;
  const client = makeClient(partialSession || "", apiId, apiHash);
  await client.connect();
  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: String(code),
        })
      );
    } catch (err) {
      const msg = err?.errorMessage || err?.message || "";
      if (String(msg).includes("SESSION_PASSWORD_NEEDED") || String(msg).includes("PASSWORD")) {
        throw new Error(
          "Esta conta tem senha de 2 etapas (2FA). Remova temporariamente no Telegram ou use outra conta."
        );
      }
      if (String(msg).includes("PHONE_CODE_INVALID") || String(msg).includes("CODE_INVALID")) {
        throw new Error("Código inválido. Confira e tente novamente.");
      }
      if (String(msg).includes("PHONE_CODE_EXPIRED") || String(msg).includes("CODE_EXPIRED")) {
        clearPending(userId);
        throw new Error("Código expirado. Reenvie o código.");
      }
      throw err;
    }

    const session = client.session.save();
    clearPending(userId);
    return {
      success: true,
      session: typeof session === "string" ? session : String(session),
      phone,
    };
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

async function handleSearchGroups(input) {
  const { session, apiId, apiHash } = input;
  if (!session) throw new Error("Não conectado");

  return withClient(session, apiId, apiHash, async (client) => {
    const dialogs = await client.getDialogs({ limit: 200 });
    const results = dialogs
      .filter((d) => {
        const entity = d.entity;
        if (!entity) return false;
        const isGroup = entity.className === "Chat" || entity.megagroup === true;
        const isChannel = entity.className === "Channel";
        return isGroup || isChannel;
      })
      .map((d) => ({
        id: String(d.id),
        name: d.name || d.title || "Sem nome",
        type: d.entity?.megagroup ? "grupo" : "canal",
      }));
    return { groups: results };
  });
}

async function handleFetchMessages(input) {
  const { session, apiId, apiHash, groupId } = input;
  if (!session) throw new Error("Não conectado");
  if (!groupId) throw new Error("groupId obrigatório");

  return withClient(session, apiId, apiHash, async (client) => {
    const messages = await client.getMessages(groupId, { limit: 8 });
    const result = (messages || [])
      .filter((m) => m && m.message)
      .map((m) => ({ id: String(m.id), text: String(m.message) }));
    return { messages: result };
  });
}

/**
 * Poll de mensagens novas do grupo (usado pelo worker PHP / COPIAR SALA DE SINAL).
 * minId: só retorna mensagens com id > minId
 */
async function handlePollMessages(input) {
  const { session, apiId, apiHash, groupId } = input;
  const minId = parseInt(String(input.minId || "0"), 10) || 0;
  const limit = Math.min(parseInt(String(input.limit || "10"), 10) || 10, 30);
  if (!session) throw new Error("Não conectado");
  if (!groupId) throw new Error("groupId obrigatório");

  return withClient(session, apiId, apiHash, async (client) => {
    // Garante autorização
    const authorized = await client.isUserAuthorized().catch(() => false);
    if (!authorized) {
      return { authorized: false, messages: [] };
    }

    const messages = await client.getMessages(groupId, { limit });
    const result = (messages || [])
      .filter((m) => m && m.message && Number(m.id) > minId)
      .map((m) => ({
        id: Number(m.id),
        text: String(m.message),
        date: m.date ? Number(m.date) : null,
      }))
      // cronológico: antigas → novas
      .sort((a, b) => a.id - b.id);

    return { authorized: true, messages: result };
  });
}

async function main() {
  let raw = "";
  if (process.argv[2]) {
    raw = process.argv[2];
  } else {
    raw = await readStdin();
  }
  if (!raw || !raw.trim()) {
    fail("Payload vazio");
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("JSON inválido");
    return;
  }

  const action = input.action;
  const apiId = parseInt(String(input.apiId || "0"), 10);
  const apiHash = String(input.apiHash || "");

  try {
    if (action === "send-code") {
      ok(await handleSendCode({ ...input, apiId, apiHash }));
      return;
    }
    if (action === "verify-code") {
      ok(await handleVerifyCode({ ...input, apiId, apiHash }));
      return;
    }
    if (action === "search-groups") {
      ok(await handleSearchGroups({ ...input, apiId, apiHash }));
      return;
    }
    if (action === "fetch-messages") {
      ok(await handleFetchMessages({ ...input, apiId, apiHash }));
      return;
    }
    if (action === "poll-messages") {
      ok(await handlePollMessages({ ...input, apiId, apiHash }));
      return;
    }
    fail("Ação inválida: " + action);
  } catch (err) {
    const message = err?.message || err?.errorMessage || String(err) || "Erro desconhecido";
    fail(message);
  }
}

main();
