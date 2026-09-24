import type { Metadata } from "next";
import { SettingsClient } from "./SettingsClient";

export const metadata: Metadata = { title: "Settings · Practiscale" };

/**
 * Assistant settings: the defaults every NEW chat starts with (model, work
 * mode, response format, knowledge scope) plus the user's saved prompts. Auth
 * is enforced by the (app) layout; model/mode options come from the shell.
 */
export default function SettingsPage() {
  return <SettingsClient />;
}
