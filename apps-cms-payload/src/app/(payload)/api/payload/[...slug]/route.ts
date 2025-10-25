import type { NextRequest } from "next/server";

import configPromise from "@/payload.config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";

export const GET = REST_GET(configPromise);
export const POST = REST_POST(configPromise);
export const PATCH = REST_PATCH(configPromise);
export const DELETE = REST_DELETE(configPromise);
export const PUT = REST_PUT(configPromise);
export const OPTIONS = REST_OPTIONS(configPromise);

export type { NextRequest };
