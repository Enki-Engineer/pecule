import { describe, expect, it } from "vitest";
import { balancesOf, isCryptocomExport, isSwissborgStatement, moveEventKind, OBSERVED, parseCryptocomExport, parseSwissborgRows } from "./crypto-files.ts";

const HEADER = "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash";
const file = (...rows: string[]) => `﻿${[HEADER, ...rows].join("\n")}\n`;

describe("export de l'appli Crypto.com", () => {
  it("se reconnaît à ses colonnes", () => {
    expect(isCryptocomExport(file())).toBe(true);
    expect(isCryptocomExport("Date,Libellé,Montant\n2026-01-01,Achat,12")).toBe(false);
    expect(parseCryptocomExport("n'importe quoi")).toBeNull();
  });

  it("additionne récompenses, achats et sorties, crypto par crypto", () => {
    const parsed = parseCryptocomExport(
      file(
        "2026-03-02 10:00:00,Card Cashback,CRO,12.5,,,EUR,1.10,1.20,referral_card_cashback,",
        "2026-03-01 09:00:00,EUR -> BTC,EUR,-100.00,BTC,0.0018,EUR,100.00,108.00,viban_purchase,",
        '2026-02-20 08:00:00,"BTC -> ETH, échange",BTC,-0.0008,ETH,0.028,EUR,45.00,48.00,crypto_exchange,',
        "2026-02-10 07:00:00,Withdraw ETH,ETH,-0.01,,,EUR,16.00,17.00,crypto_withdrawal,0xabc",
      ),
    )!;
    expect(parsed.rows).toBe(4);
    expect(parsed.internal).toBe(0);
    expect(parsed.from).toBe("2026-02-10 07:00:00");
    expect(parsed.to).toBe("2026-03-02 10:00:00");
    const balances = balancesOf(parsed.moves);
    expect(balances.get("CRO")).toBe(12.5);
    expect(balances.get("BTC")).toBeCloseTo(0.001);
    expect(balances.get("ETH")).toBeCloseTo(0.018);
    // La monnaie dépensée vit dans un autre portefeuille de l'appli : elle n'est pas suivie ici.
    expect(balances.has("EUR")).toBe(false);
  });

  it("ne retire pas du solde ce qui est seulement immobilisé dans l'appli", () => {
    const parsed = parseCryptocomExport(
      file(
        "2026-01-05 10:00:00,Reward,CRO,5,,,EUR,0.5,0.5,mco_stake_reward,",
        "2026-01-04 10:00:00,Stake,CRO,-1000,,,EUR,90,95,lockup_lock,",
        "2026-01-03 10:00:00,Supercharger,CRO,-200,,,EUR,18,19,supercharger_deposit,",
        "2026-01-02 10:00:00,Stake on chain,CRO,-300,,,EUR,27,28,finance.dpos.staking.crypto_wallet,",
        "2026-01-02 09:00:00,Unlock,CRO,300,,,EUR,27,28,finance.lockup.dpos_unlock.crypto_wallet,",
        "2026-01-01 10:00:00,Buy CRO,EUR,-150,CRO,1600,EUR,150,160,viban_purchase,",
      ),
    )!;
    expect(parsed.internal).toBe(4);
    expect(balancesOf(parsed.moves).get("CRO")).toBe(1605);
  });

  it("garde un échange de jeton (ce qui part, ce qui arrive) et ramène un symbole propre à l'appli", () => {
    const parsed = parseCryptocomExport(
      file(
        "2026-01-03 10:00:00,Swap,AAA,-50,,,EUR,5,5,crypto_wallet_swap_debited,",
        "2026-01-03 10:00:00,Swap,BBB,5,,,EUR,5,5,crypto_wallet_swap_credited,",
        "2026-01-02 10:00:00,Airdrop,LUNA2,1.5,,,EUR,1,1,admin_wallet_credited,",
        "2026-01-01 10:00:00,Reward,AAA,50,,,EUR,5,5,supercharger_reward_to_app_credited,",
      ),
    )!;
    const balances = balancesOf(parsed.moves);
    expect(balances.get("AAA")).toBe(0);
    expect(balances.get("BBB")).toBe(5);
    expect(balances.get("LUNA")).toBe(1.5);
  });

  it("reconnaît l'export du portefeuille en monnaie, et n'en tire aucun mouvement", () => {
    // Mêmes colonnes ; l'achat y est en positif, et il figure déjà dans l'export des cryptos.
    const parsed = parseCryptocomExport(file("2026-03-01 09:00:00,EUR -> BTC,EUR,100.00,BTC,0.0018,EUR,100.00,108.00,viban_purchase,", "2026-02-28 09:00:00,Dépôt,EUR,100.00,,,EUR,100.00,108.00,viban_deposit,"))!;
    expect(parsed.fiat).toBe(true);
    expect(parsed.moves).toEqual([]);
    // Un export de cryptos où l'on n'a fait qu'acheter reste un export de cryptos : l'euro y part en négatif.
    const buys = parseCryptocomExport(file("2026-03-01 09:00:00,EUR -> BTC,EUR,-100.00,BTC,0.0018,EUR,100.00,108.00,viban_purchase,"))!;
    expect(buys.fiat).toBe(false);
    expect(buys.moves.map((m) => [m.symbol, m.amount])).toEqual([["BTC", 0.0018]]);
  });

  it("donne à chaque mouvement une clé stable, même pour deux lignes identiques", () => {
    const rows = ["2026-01-01 10:00:00,Reward,CRO,1,,,EUR,0.1,0.1,mco_stake_reward,", "2026-01-01 10:00:00,Reward,CRO,1,,,EUR,0.1,0.1,mco_stake_reward,"];
    const first = parseCryptocomExport(file(...rows))!.moves;
    expect(new Set(first.map((m) => m.key)).size).toBe(2);
    // Le même fichier relu donne les mêmes clés : un second dépôt n'ajoute rien.
    expect(parseCryptocomExport(file(...rows))!.moves.map((m) => m.key)).toEqual(first.map((m) => m.key));
    // Un échange donne deux mouvements, deux clés.
    const trade = parseCryptocomExport(file("2026-02-20 08:00:00,BTC -> ETH,BTC,-0.0008,ETH,0.028,EUR,45,48,crypto_exchange,"))!.moves;
    expect(trade.map((m) => [m.symbol, m.amount])).toEqual([["BTC", -0.0008], ["ETH", 0.028]]);
    expect(trade[0].key).not.toBe(trade[1].key);
  });

  it("part du solde constaté d'une crypto et n'y ajoute que ce qui vient après", () => {
    const moves = [
      { symbol: "BTC", amount: 0.01, at: "2026-01-10 08:00:00", kind: "viban_purchase" },
      { symbol: "BTC", amount: 0.002, at: "2026-02-01 08:00:00", kind: "supercharger_reward_to_app_credited" },
      // L'appli affiche 0,0125 BTC le 1er mars : l'export a un trou de 0,0005.
      { symbol: "BTC", amount: 0.0125, at: "2026-03-01 12:00:00", kind: OBSERVED },
      { symbol: "BTC", amount: 0.001, at: "2026-03-05 08:00:00", kind: "supercharger_reward_to_app_credited" },
      // Une crypto que l'export ne cite jamais, et une autre sans solde constaté.
      { symbol: "SHIB", amount: 150000, at: "2026-03-01 12:00:00", kind: OBSERVED },
      { symbol: "CRO", amount: 40, at: "2026-01-02 08:00:00", kind: "mco_stake_reward" },
    ];
    const balances = balancesOf(moves);
    expect(balances.get("BTC")).toBeCloseTo(0.0135);
    expect(balances.get("SHIB")).toBe(150000);
    expect(balances.get("CRO")).toBe(40);
    // Un solde constaté plus récent remplace l'ancien ; un export déposé ensuite, qui recouvre le passé, ne change rien.
    const later = [...moves, { symbol: "BTC", amount: 0.02, at: "2026-04-01 09:00:00", kind: OBSERVED }, { symbol: "BTC", amount: 0.5, at: "2025-12-01 08:00:00", kind: "crypto_deposit" }];
    expect(balancesOf(later).get("BTC")).toBe(0.02);
    // Constaté à zéro : la crypto ne compte plus rien, jusqu'au prochain mouvement.
    expect(balancesOf([...moves, { symbol: "CRO", amount: 0, at: "2026-02-01 00:00:00", kind: OBSERVED }]).get("CRO")).toBe(0);
  });
});

describe("relevé de compte SwissBorg", () => {
  const HEAD = ["Local time", "Time in UTC", "Type", "Currency", "Gross amount", "Gross amount (EUR)", "Fee", "Fee (EUR)", "Net amount", "Net amount (EUR)", "Note"];
  /** Les premières lignes d'un relevé décrivent le compte ; les colonnes viennent ensuite. */
  const sheet = (...rows: string[][]) => [["Société", "", "", "Name", "Alex"], ["", "", "", "Local Currency", "EUR"], [], HEAD, ...rows];
  const row = (utc: string, type: string, currency: string, gross: string, fee: string, net: string, note = "") => [utc, utc, type, currency, gross, "1", fee, "0", net, "1", note];

  it("se reconnaît à ses colonnes, où qu'elles soient dans la feuille", () => {
    expect(isSwissborgStatement(sheet())).toBe(true);
    expect(isSwissborgStatement([["Date", "Libellé", "Montant"]])).toBe(false);
    expect(parseSwissborgRows([["Local time", "Autre chose"]])).toBeNull();
  });

  it("fait entrer dépôts, achats et versements pour leur net, sortir ventes et retraits pour leur brut", () => {
    const parsed = parseSwissborgRows(
      sheet(
        row("2026-01-02 09:00:00", "Deposit", "EUR", "500.0", "0.0", "500.0"),
        row("2026-01-03 09:00:00", "Buy", "BTC", "0.0101", "0.0001", "0.01"),
        row("2026-01-04 02:00:00", "Payouts", "BTC", "1.2E-7", "0.0", "1.2E-7", "Yield payouts"),
        row("2026-01-04 02:00:00", "Payouts", "BTC", "1.2E-7", "0.0", "1.2E-7", "Yield payouts"),
        row("2026-02-01 09:00:00", "Withdrawal", "BTC", "0.004", "0.0005", "0.0035"),
        row("2026-03-01 09:00:00", "Sell", "AAA", "30.0", "0.0", "30.0", "Migration to 3.0 BBB"),
        row("2026-03-01 09:00:00", "Buy", "BBB", "3.0", "0.0", "3.0", "Migration from 30.0 AAA"),
        row("2026-02-20 09:00:00", "Payouts", "AAA", "30.0", "0.0", "30.0"),
      ),
    )!;
    expect(parsed.rows).toBe(8);
    expect(parsed.from).toBe("2026-01-02 09:00:00");
    expect(parsed.to).toBe("2026-03-01 09:00:00");
    expect(parsed.unknown).toEqual([]);
    const balances = balancesOf(parsed.moves);
    // 0,01 acheté (net) + deux versements égaux à la seconde près − 0,004 sorti (brut, frais compris).
    expect(balances.get("BTC")).toBeCloseTo(0.01 + 2.4e-7 - 0.004, 12);
    expect(balances.get("AAA")).toBe(0);
    expect(balances.get("BBB")).toBe(3);
    // La monnaie déposée n'est pas suivie.
    expect(balances.has("EUR")).toBe(false);
    expect(new Set(parsed.moves.map((m) => m.key)).size).toBe(parsed.moves.length);
  });

  it("laisse de côté un genre de ligne inconnu, et le dit", () => {
    const parsed = parseSwissborgRows(sheet(row("2026-01-02 09:00:00", "Payouts", "BTC", "0.001", "0.0", "0.001"), row("2026-01-03 09:00:00", "Mystère", "BTC", "5", "0", "5")))!;
    expect(parsed.unknown).toEqual(["Mystère"]);
    expect(balancesOf(parsed.moves).get("BTC")).toBe(0.001);
  });
});

describe("genre du journal d'une ligne d'export", () => {
  it("range les genres que les applis écrivent", () => {
    const expected: [string, string][] = [
      ["crypto_purchase", "achat"],
      ["viban_purchase", "achat"],
      ["buy", "achat"],
      ["crypto_viban_exchange", "vente"],
      ["sell", "vente"],
      ["crypto_exchange", "echange"],
      ["dust_conversion_credited", "echange"],
      ["crypto_withdrawal", "transfert"],
      ["crypto_deposit", "transfert"],
      ["crypto_to_exchange_transfer", "transfert"],
      ["deposit", "transfert"],
      ["withdrawal", "transfert"],
      ["referral_card_cashback", "prime"],
      ["reimbursement", "prime"],
      ["rewards_platform_deposit_credited", "prime"],
      ["crypto_earn_interest_paid", "interets"],
      ["payouts", "interets"],
      ["mco_stake_reward", "recompense"],
      ["supercharger_reward_to_app_credited", "recompense"],
    ];
    for (const [kind, type] of expected) expect(moveEventKind(kind), kind).toBe(type);
    expect(moveEventKind("Crypto_Purchase")).toBe("achat");
  });

  it("ne devine pas un genre inconnu, ni un solde constaté", () => {
    expect(moveEventKind("admin_wallet_credited")).toBeNull();
    expect(moveEventKind("crypto_payment")).toBeNull();
    expect(moveEventKind(OBSERVED)).toBeNull();
  });
});
