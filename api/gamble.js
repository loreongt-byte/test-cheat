const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

function json(res, status, data) {
  res.status(status).json(data);
}

async function db(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "object" && data?.message
        ? data.message
        : `Database error ${response.status}`
    );
  }

  return data;
}

function cookies(req) {
  const header = req.headers.cookie || "";
  const out = {};

  header.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i === -1) return;

    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();

    out[key] = decodeURIComponent(value);
  });

  return out;
}

function accountJSON(account, role = false) {
  return {
    growId: account.growid,
    discordLinked: !!account.discord_id,
    hasRequiredRole: role,
    balance: Number(account.credits || 0),
    xp: Number(account.xp || 0),
    level: Number(account.level || 1),
    nextLevelXp: 100
  };
}

function levelForXP(xp) {
  let level = 1;
  let need = 100;
  let remaining = Number(xp || 0);

  while (remaining >= need && level < 100) {
    remaining -= need;
    level++;
    need = Math.floor(100 * Math.pow(1.22, level - 1));
  }

  return {
    level,
    nextLevelXp: need
  };
}

async function getAccountBySession(req) {
  const sid = cookies(req).cheat_gamble_sid;

  if (!sid) return null;

  const rows = await db(
    `web_sessions?session_token=eq.${encodeURIComponent(sid)}&select=*`
  );

  if (!rows.length) return null;

  const session = rows[0];

  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }

  const accounts = await db(
    `gamble_accounts?id=eq.${session.account_id}&select=*`
  );

  return accounts[0] || null;
}

async function hasDiscordRole(discordId) {
  const roleId = process.env.DISCORD_REQUIRED_ROLE_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!roleId || !botToken || !guildId || !discordId) {
    return false;
  }

  try {
    const r = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`
        }
      }
    );

    if (!r.ok) return false;

    const member = await r.json();

    return Array.isArray(member.roles) &&
      member.roles.includes(roleId);
  } catch {
    return false;
  }
}

async function requireAccount(req, res) {
  const account = await getAccountBySession(req);

  if (!account) {
    json(res, 401, { error: "Not linked" });
    return null;
  }

  return account;
}

async function addXP(account, amount) {
  const xp = Number(account.xp || 0) + Number(amount || 0);
  const levelInfo = levelForXP(xp);

  await db(`gamble_accounts?id=eq.${account.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      xp,
      level: levelInfo.level,
      updated_at: new Date().toISOString()
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  return {
    xp,
    level: levelInfo.level
  };
}

async function addHistory(accountId, game, label, bet, payout) {
  await db("game_history", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      game,
      bet: Number(bet || 0),
      payout: Number(payout || 0),
      result: {
        label
      }
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });
}

async function changeCredits(account, delta) {
  const current = Number(account.credits || 0);
  const next = current + Number(delta || 0);

  if (next < 0) {
    throw new Error("Insufficient credits");
  }

  const updated = await db(
    `gamble_accounts?id=eq.${account.id}&credits=eq.${current}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        credits: next,
        updated_at: new Date().toISOString()
      }),
      headers: {
        Prefer: "return=representation"
      }
    }
  );

  if (!updated.length) {
    throw new Error("Balance changed. Please try again.");
  }

  return updated[0];
}

async function completeLink(req, res) {
  const code = String(req.body?.code || "").trim();

  if (!/^\d{6}$/.test(code)) {
    return json(res, 400, {
      error: "Enter a valid 6-digit code"
    });
  }

  const rows = await db(
    `link_codes?code=eq.${code}&used=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*`
  );

  if (!rows.length) {
    return json(res, 400, {
      error: "Invalid or expired link code"
    });
  }

  const link = rows[0];

  const existing = await db(
    `gamble_accounts?or=(growid.eq.${encodeURIComponent(link.growid)},discord_id.eq.${encodeURIComponent(link.discord_id)})&select=*`
  );

  let account;

  if (existing.length) {
    account = existing[0];

    if (
      account.growid !== link.growid ||
      account.discord_id !== link.discord_id
    ) {
      return json(res, 409, {
        error: "GrowID or Discord is already linked to another account"
      });
    }
  } else {
    const created = await db("gamble_accounts", {
      method: "POST",
      body: JSON.stringify({
        growid: link.growid,
        discord_id: link.discord_id,
        credits: 0,
        xp: 0,
        level: 1
      }),
      headers: {
        Prefer: "return=representation"
      }
    });

    account = created[0];
  }

  await db(`link_codes?id=eq.${link.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      used: true
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  const sessionToken = crypto.randomBytes(32).toString("hex");

  await db("web_sessions", {
    method: "POST",
    body: JSON.stringify({
      session_token: sessionToken,
      account_id: account.id,
      expires_at: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString()
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  res.setHeader(
    "Set-Cookie",
    `cheat_gamble_sid=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
  );

  const role = await hasDiscordRole(account.discord_id);

  return json(res, 200, {
    account: accountJSON(account, role)
  });
}

async function openCase(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const role = await hasDiscordRole(account.discord_id);

  if (!role) {
    return json(res, 403, {
      error: "Required Discord role is missing"
    });
  }

  const caseId = String(req.body?.caseId || "");

  const cooldowns = {
    daily: 24 * 60 * 60,
    weekly: 7 * 24 * 60 * 60,
    monthly: 30 * 24 * 60 * 60
  };

  const rewards = {
    daily: [50, 75, 100, 150, 250],
    weekly: [250, 400, 600, 900, 1500],
    monthly: [1000, 1500, 2500, 4000, 7500],
    tier1: [25, 50, 75],
    tier2: [50, 100, 150, 250],
    tier3: [100, 200, 350, 500],
    tier4: [250, 400, 650, 1000],
    tier5: [500, 750, 1200, 2000]
  };

  if (!rewards[caseId]) {
    return json(res, 400, {
      error: "Unknown case"
    });
  }

  if (cooldowns[caseId]) {
    const claims = await db(
      `case_claims?account_id=eq.${account.id}&case_type=eq.${caseId}&select=claimed_at&order=claimed_at.desc&limit=1`
    );

    if (claims.length) {
      const last = new Date(claims[0].claimed_at).getTime();
      const wait = cooldowns[caseId] * 1000;
      const remaining = last + wait - Date.now();

      if (remaining > 0) {
        return json(res, 429, {
          error: `Case available again in ${Math.ceil(remaining / 1000)} seconds`
        });
      }
    }
  }

  const list = rewards[caseId];
  const reward = list[crypto.randomInt(list.length)];

  const updated = await changeCredits(account, reward);

  await db("case_claims", {
    method: "POST",
    body: JSON.stringify({
      account_id: account.id,
      case_type: caseId,
      reward
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  await addHistory(
    account.id,
    "case",
    caseId,
    0,
    reward
  );

  await addXP(
    account,
    Math.min(50, Math.max(5, Math.floor(reward / 10)))
  );

  return json(res, 200, {
    reward,
    account: accountJSON(
      updated,
      true
    )
  });
}

async function playGame(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const role = await hasDiscordRole(account.discord_id);

  if (!role) {
    return json(res, 403, {
      error: "Required Discord role is missing"
    });
  }

  const game = String(req.body?.game || "");
  const choice = String(req.body?.choice || "");
  const wager = Number(req.body?.wager);

  if (
    !Number.isInteger(wager) ||
    wager < 1 ||
    wager > 100000
  ) {
    return json(res, 400, {
      error: "Invalid wager"
    });
  }

  if (Number(account.credits) < wager) {
    return json(res, 400, {
      error: "Insufficient credits"
    });
  }

  let multiplier = 0;
  let message = "";

  if (game === "coinflip") {
    const result = crypto.randomInt(2)
      ? "heads"
      : "tails";

    const win = result === choice;

    multiplier = win ? 1.95 : 0;

    message =
      `Landed ${result}. ` +
      (win ? "You win!" : "You lose.");
  }

  else if (game === "dice") {
    const roll = crypto.randomInt(1, 101);

    const win =
      choice === "low"
        ? roll <= 49
        : roll >= 51;

    multiplier = win ? 1.95 : 0;

    message =
      `Rolled ${roll}. ` +
      (win ? "You win!" : "You lose.");
  }

  else if (game === "roulette") {
    const n = crypto.randomInt(37);

    const result =
      n === 0
        ? "green"
        : n % 2
          ? "red"
          : "black";

    const win = result === choice;

    multiplier = win
      ? result === "green"
        ? 14
        : 1.95
      : 0;

    message =
      `Wheel: ${result}. ` +
      (win ? "You win!" : "You lose.");
  }

  else if (game === "plinko") {
    const sets = {
      low: [0, 0, 0.5, 0.8, 1, 1, 1.2, 1.5, 2],
      medium: [0, 0.3, 0.5, 0.7, 1, 1, 1.5, 2.5, 5],
      high: [0, 0, 0.2, 0.5, 1, 1, 2, 5, 12]
    };

    const arr = sets[choice] || sets.medium;

    multiplier =
      arr[crypto.randomInt(arr.length)];

    message =
      `Ball landed on ${multiplier.toFixed(2)}×.`;
  }

  else {
    return json(res, 400, {
      error: "Unknown game"
    });
  }

  const payout = Math.floor(wager * multiplier);
  const delta = payout - wager;

  const updated = await changeCredits(
    account,
    delta
  );

  await addXP(
    account,
    Math.min(100, Math.max(1, Math.floor(wager / 25)))
  );

  await addHistory(
    account.id,
    game,
    game.toUpperCase(),
    wager,
    delta
  );

  return json(res, 200, {
    message,
    delta,
    account: accountJSON(updated, true)
  });
}

async function history(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const rows = await db(
    `game_history?account_id=eq.${account.id}&select=game,bet,payout,result,created_at&order=id.desc&limit=15`
  );

  const items = rows.map(row => ({
    label:
      row.result?.label ||
      row.game?.toUpperCase() ||
      "GAME",
    delta: Number(row.payout || 0)
  }));

  return json(res, 200, {
    items
  });
}

async function account(req, res) {
  const a = await requireAccount(req, res);
  if (!a) return;

  const role = await hasDiscordRole(a.discord_id);

  return json(res, 200, {
    account: accountJSON(a, role)
  });
}

async function createLinkCode(req, res) {
  const secret =
    req.headers["x-gtps-secret"] ||
    req.body?.secret ||
    req.query?.secret;

  if (
    !process.env.GTPS_BRIDGE_SECRET ||
    secret !== process.env.GTPS_BRIDGE_SECRET
  ) {
    return json(res, 401, {
      error: "Unauthorized bridge"
    });
  }

  const growId = String(req.body?.growId || "").trim();
  const discordId = String(req.body?.discordId || "").trim();

  if (!growId || !discordId) {
    return json(res, 400, {
      error: "growId and discordId required"
    });
  }

  const code = String(
    crypto.randomInt(100000, 1000000)
  );

  await db("link_codes", {
    method: "POST",
    body: JSON.stringify({
      code,
      growid: growId,
      discord_id: discordId,
      expires_at: new Date(
        Date.now() + 5 * 60 * 1000
      ).toISOString(),
      used: false
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  return json(res, 200, {
    code,
    expiresIn: 300
  });
}

async function deposit(req, res) {
  const secret =
    req.headers["x-gtps-secret"] ||
    req.body?.secret ||
    req.query?.secret;

  if (
    !process.env.GTPS_BRIDGE_SECRET ||
    secret !== process.env.GTPS_BRIDGE_SECRET
  ) {
    return json(res, 401, {
      error: "Unauthorized bridge"
    });
  }

  const growId = String(req.body?.growId || "").trim();
  const amount = Number(req.body?.amount);

  if (
    !growId ||
    !Number.isInteger(amount) ||
    amount < 1
  ) {
    return json(res, 400, {
      error: "Invalid deposit"
    });
  }

  const rows = await db(
    `gamble_accounts?growid=eq.${encodeURIComponent(growId)}&select=*`
  );

  if (!rows.length) {
    return json(res, 404, {
      error: "Gamble account not linked"
    });
  }

  const account = rows[0];

  const updated = await changeCredits(
    account,
    amount
  );

  await addHistory(
    account.id,
    "deposit",
    "GTPS DEPOSIT",
    amount,
    amount
  );

  return json(res, 200, {
    ok: true,
    balance: Number(updated.credits)
  });
}

async function payout(req, res) {
  const secret =
    req.headers["x-gtps-secret"] ||
    req.body?.secret ||
    req.query?.secret;

  if (
    !process.env.GTPS_BRIDGE_SECRET ||
    secret !== process.env.GTPS_BRIDGE_SECRET
  ) {
    return json(res, 401, {
      error: "Unauthorized bridge"
    });
  }

  const growId = String(
    req.query?.growId ||
    req.body?.growId ||
    ""
  ).trim();

  const rows = await db(
    `cashouts?growid=eq.${encodeURIComponent(growId)}&status=eq.pending&select=*&order=id.asc&limit=1`
  );

  return json(res, 200, {
    payout: rows[0] || null
  });
}

async function completePayout(req, res) {
  const secret =
    req.headers["x-gtps-secret"] ||
    req.body?.secret ||
    req.query?.secret;

  if (
    !process.env.GTPS_BRIDGE_SECRET ||
    secret !== process.env.GTPS_BRIDGE_SECRET
  ) {
    return json(res, 401, {
      error: "Unauthorized bridge"
    });
  }

  const id = Number(req.body?.id);

  if (!Number.isInteger(id)) {
    return json(res, 400, {
      error: "Invalid payout id"
    });
  }

  await db(
    `cashouts?id=eq.${id}&status=eq.pending`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "paid",
        paid_at: new Date().toISOString()
      }),
      headers: {
        Prefer: "return=minimal"
      }
    }
  );

  return json(res, 200, {
    ok: true
  });
}

async function cashout(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const amount = Number(req.body?.amount);

  if (!Number.isInteger(amount) || amount < 1) {
    return json(res, 400, {
      error: "Invalid amount"
    });
  }

  if (Number(account.credits) < amount) {
    return json(res, 400, {
      error: "Insufficient credits"
    });
  }

  const pending = await db(
    `cashouts?account_id=eq.${account.id}&status=eq.pending&select=id&limit=1`
  );

  if (pending.length) {
    return json(res, 409, {
      error: "You already have a pending cashout"
    });
  }

  const updated = await changeCredits(
    account,
    -amount
  );

  await db("cashouts", {
    method: "POST",
    body: JSON.stringify({
      account_id: account.id,
      growid: account.growid,
      amount,
      status: "pending"
    }),
    headers: {
      Prefer: "return=minimal"
    }
  });

  await addHistory(
    account.id,
    "cashout",
    "CASHOUT REQUEST",
    0,
    -amount
  );

  const role = await hasDiscordRole(account.discord_id);

  return json(res, 200, {
    account: accountJSON(updated, role)
  });
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json(res, 500, {
      error: "Supabase environment variables are missing"
    });
  }

  try {
    const path = req.url.split("?")[0];

    if (req.method === "GET" && path.endsWith("/account"))
      return await account(req, res);

    if (req.method === "POST" && path.endsWith("/link/complete"))
      return await completeLink(req, res);

    if (req.method === "POST" && path.endsWith("/cases/open"))
      return await openCase(req, res);

    if (req.method === "POST" && path.endsWith("/play"))
      return await playGame(req, res);

    if (req.method === "GET" && path.endsWith("/history"))
      return await history(req, res);

    if (req.method === "POST" && path.endsWith("/cashout"))
      return await cashout(req, res);

    if (req.method === "POST" && path.endsWith("/gtps/link-code"))
      return await createLinkCode(req, res);

    if (req.method === "POST" && path.endsWith("/gtps/deposit"))
      return await deposit(req, res);

    if (req.method === "GET" && path.endsWith("/gtps/payouts"))
      return await payout(req, res);

    if (
      req.method === "POST" &&
      path.endsWith("/gtps/payouts/complete")
    )
      return await completePayout(req, res);

    return json(res, 404, {
      error: "Route not found"
    });
  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error: error.message || "Server error"
    });
  }
}

module.exports = handler;
