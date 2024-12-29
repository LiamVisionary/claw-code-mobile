"use server";

export async function pingServer() {
  return "pong";
}
export async function pingServerError() {
  throw new Error("test error");
}
