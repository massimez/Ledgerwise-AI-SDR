"use client";

import { AuthModalProvider } from "@workspace/ui/components/auth/auth-modal-provider";
import { sanitizeInternalRedirect } from "@workspace/ui/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	createContext,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import { publicWebEnv } from "@/env";
import { authClient, useSession } from "@/lib/auth-client";

interface AuthOpenOptions {
	onSuccess?: () => Promise<void> | void;
	redirectTo?: string;
	socialRedirectTo?: string;
}

interface AuthContextType {
	closeAuthModal: () => void;
	openSignIn: (options?: AuthOpenOptions | string) => void;
	openSignUp: (options?: AuthOpenOptions | string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeAuthOptions = (
	options?: AuthOpenOptions | string
): AuthOpenOptions => {
	if (typeof options === "string") {
		return { redirectTo: sanitizeInternalRedirect(options) };
	}
	return {
		onSuccess: options?.onSuccess,
		redirectTo: sanitizeInternalRedirect(options?.redirectTo),
		socialRedirectTo: sanitizeInternalRedirect(options?.socialRedirectTo),
	};
};

function AuthQuerySync({
	openSignIn,
	openSignUp,
}: {
	openSignIn: (options?: AuthOpenOptions | string) => void;
	openSignUp: (options?: AuthOpenOptions | string) => void;
}) {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const router = useRouter();
	const { data: session, isPending } = useSession();

	useEffect(() => {
		const authParam = searchParams.get("auth");
		if (authParam !== "signin" && authParam !== "signup") {
			return;
		}
		if (isPending) {
			return;
		}

		const target =
			sanitizeInternalRedirect(searchParams.get("callbackUrl")) ?? "/dashboard";

		if (session?.user) {
			router.replace(target);
			return;
		}

		if (authParam === "signup") {
			openSignUp({ redirectTo: target });
		} else {
			openSignIn({ redirectTo: target });
		}

		const nextParams = new URLSearchParams(searchParams.toString());
		nextParams.delete("auth");
		nextParams.delete("callbackUrl");
		const query = nextParams.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	}, [
		isPending,
		openSignIn,
		openSignUp,
		pathname,
		router,
		searchParams,
		session?.user,
	]);

	return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const [view, setView] = useState<"signIn" | "signUp">("signIn");
	const [redirectTo, setRedirectTo] = useState<string | undefined>(undefined);
	const [socialRedirectTo, setSocialRedirectTo] = useState<string | undefined>(
		undefined
	);
	const [successHandler, setSuccessHandler] = useState<
		(() => Promise<void> | void) | undefined
	>(undefined);
	const router = useRouter();

	const openSignIn = useCallback((options?: AuthOpenOptions | string) => {
		const normalized = normalizeAuthOptions(options);
		setRedirectTo(normalized.redirectTo);
		setSocialRedirectTo(normalized.socialRedirectTo);
		setSuccessHandler(() => normalized.onSuccess);
		setView("signIn");
		setIsOpen(true);
	}, []);

	const openSignUp = useCallback((options?: AuthOpenOptions | string) => {
		const normalized = normalizeAuthOptions(options);
		setRedirectTo(normalized.redirectTo);
		setSocialRedirectTo(normalized.socialRedirectTo);
		setSuccessHandler(() => normalized.onSuccess);
		setView("signUp");
		setIsOpen(true);
	}, []);

	const closeAuthModal = useCallback(() => {
		setIsOpen(false);
	}, []);

	const handleSuccess = useCallback(async () => {
		setIsOpen(false);
		if (successHandler) {
			await successHandler();
			setSuccessHandler(undefined);
			if (redirectTo) {
				router.push(redirectTo);
			}
			return;
		}
		router.push(redirectTo ?? "/dashboard");
	}, [redirectTo, router, successHandler]);

	const value = useMemo(
		() => ({
			closeAuthModal,
			openSignIn,
			openSignUp,
		}),
		[closeAuthModal, openSignIn, openSignUp]
	);

	return (
		<AuthContext.Provider value={value}>
			<Suspense fallback={null}>
				<AuthQuerySync openSignIn={openSignIn} openSignUp={openSignUp} />
			</Suspense>
			{children}
			<AuthModalProvider
				authClient={authClient}
				defaultView={view}
				googleAuthEnabled={publicWebEnv.googleAuthEnabled}
				onOpenChange={setIsOpen}
				onSignInSuccess={handleSuccess}
				onSignUpSuccess={handleSuccess}
				open={isOpen}
				redirectTo={redirectTo}
				socialRedirectTo={socialRedirectTo}
				toast={toast}
			/>
		</AuthContext.Provider>
	);
}

export function useAuthModal() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuthModal must be used within an AuthProvider");
	}
	return context;
}
