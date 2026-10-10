"use server";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";
import { isInternalEmailAllowed } from "@/lib/auth/access-policy";

import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

const registrationSchema = authFormSchema.extend({
  inviteCode: z.string().min(1).max(512),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "not_allowed"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = registrationSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
      inviteCode: formData.get("inviteCode"),
    });

    const configuredCode = process.env.GROKBOT_SIGNUP_KEY;
    // An email allowlist by itself is not proof of address ownership. An
    // uninvited attacker must never claim an allowlisted email first.
    if (
      !configuredCode ||
      configuredCode.length < 32 ||
      !isInternalEmailAllowed(validatedData.email)
    ) {
      return { status: "not_allowed" };
    }
    const supplied = Buffer.from(validatedData.inviteCode);
    const expected = Buffer.from(configuredCode);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return { status: "not_allowed" };
    }

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }
    await createUser(validatedData.email, validatedData.password);
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
