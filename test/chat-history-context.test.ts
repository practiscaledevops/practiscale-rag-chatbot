import { describe, expect, it } from "vitest";
import { fitChatContext } from "@/lib/chat-history-context";
import { fitMessagesForBrain, type BrainMessage } from "@/lib/brain";

const citation = "8cd8e503-34f1-4da0-a105-536d76336c2b";
const at = "2026-10-29T12:00:00.000Z";
const turn = (content: string): BrainMessage => ({ role: "user", content, createdAt: at });
const answer = (content: string): BrainMessage => ({ role: "assistant", content, createdAt: at });
const filler = Array.from({ length: 36 }, (_, i) => [
  turn("Review the draft paragraph " + i + "."),
  answer("This is the discussion of the draft paragraph. ".repeat(25)),
]).flat();

describe("compact chat requests", () => {
  it("shrinks the model history and keeps source IDs attached to earlier matching quotes", () => {
    const policy = "Send the appointment reminder 2 hours before it starts. [" + citation + "]";
    const transcript = [turn("What is the appointment reminder policy?"), answer(policy), ...filler,
      turn("What did we say earlier about the appointment reminder?")];
    const packed = fitChatContext(transcript);
    expect(packed.messages.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(fitMessagesForBrain(transcript)).length / 2);
    expect(packed.earlierContext?.excerpts).toContainEqual({ role: "assistant", content: policy, createdAt: at });
    expect(transcript[1].content).toBe(policy);
  });

  it("finds the user's earlier reference across a saved summary without using an assistant's guess", () => {
    const statement = "My reference in this conversation is maple-82.";
    const summary: BrainMessage = { role: "system", content: "[Conversation summary]\nWe discussed appointments." };
    const questions = Array.from({ length: 15 }, () => turn("Do you need me to share the reference?"));
    const transcript = [turn(statement), answer("Your reference is incorrect-code."), ...filler, ...questions, summary,
      turn("What reference did I give you earlier?")];
    const packed = fitChatContext(transcript);
    expect(packed.messages[0]).toEqual(summary);
    expect(packed.earlierContext?.userTurns).toEqual([{ content: statement, createdAt: at }]);
    expect(JSON.stringify(packed)).not.toContain("incorrect-code");
  });

  it("keeps the original timestamped report request and all scope changes in order", () => {
    const original = turn("Show Payroll closings this week.");
    const result = fitChatContext([
      original, answer("October 26–29"),
      ...Array.from({ length: 52 }, () => [turn("Just Team Fahad"), answer("Team Fahad.")]).flat(),
      turn("Compare against 2026-10-19"),
    ]);
    expect(result.messages).not.toContain(original);
    expect(result.earlierContext?.userTurns?.[0]).toEqual({ content: original.content, createdAt: at });
    expect(result.earlierContext?.userTurns?.at(-1)?.content).toBe("Just Team Fahad");
  });

  it("uses the wider existing window for requests about the whole conversation", () => {
    const transcript = [...filler, turn("Summarize the whole conversation.")];
    expect(fitChatContext(transcript).messages).toEqual(fitMessagesForBrain(transcript));
  });

  it("passes older reporting choices for a natural question about the scope", () => {
    const original = turn("Show Payroll closings this week.");
    const team = turn("Just Team Fahad.");
    const result = fitChatContext([original, team, ...filler, turn("What was our scope?")]);
    expect(result.messages).not.toContainEqual(original);
    expect(result.earlierContext?.userTurns?.slice(0, 2)).toEqual([
      { content: original.content, createdAt: at }, { content: team.content, createdAt: at },
    ]);
  });

  it("keeps an original citation at the end of the relevant paragraph without keeping unrelated citations", () => {
    const other = "7eaf8791-17dd-45bc-84e4-111a93ffe293";
    const passage = "For appointment attendance, count only appointments with a status of Showed.";
    const prior = answer(`${passage} Booked alone does not count. [${citation}]\n\nFor onboarding, verify the email first. [${other}]`);
    const prompt = turn("What did we decide earlier about appointment attendance?");
    const history = [turn("Show my appointment attendance"), prior];
    const long = fitChatContext([...history, ...filler, prompt]);
    expect(long.earlierContext?.excerpts).toContainEqual({ role: "assistant", content: passage, createdAt: at, citationIds: [citation] });
    expect(fitChatContext([...history, prompt]).earlierContext?.citationIds).toEqual([citation]);
  });
});
