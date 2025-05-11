// main.ts - Super Simple Test File for Deno Deploy

import { serve } from "https://deno.land/std@0.224.2/http/server.ts";

console.log("Handler function starting...");

serve(async (request) => {
  const url = new URL(request.url);
  console.log(`Request received for: ${url.pathname}`);
  return new Response("Hello from Super Simple Deno Deploy!");
});

console.log("Server started.");
