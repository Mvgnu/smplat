import type { ReactNode } from "react";

import config from "@/payload.config";
import { importMap } from "@/importMap";
import { RootLayout as PayloadRootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import "./globals.css";

export async function serverFunction(args: any) {
	"use server";
	return handleServerFunctions({ ...args, config: Promise.resolve(config), importMap });
}

export default async function RootLayout({ children }: { children: ReactNode }) {
	return PayloadRootLayout({
		children,
		config: Promise.resolve(config),
		importMap,
		serverFunction,
	});
}
