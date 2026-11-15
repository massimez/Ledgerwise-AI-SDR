export {
	countEmailWords,
	detectBotQuestion,
	detectHardOptOutIntent,
	detectOptOutIntent,
	detectOutboundPriceViolation,
	stripQuotedReplyText,
	verifyBotDisclosure,
} from "./guards/content-guards";
export {
	type FirstEmailValidationInput,
	type FirstEmailValidationResult,
	type ReplyValidationInput,
	validateFirstEmailConstraints,
	validateReplyConstraints,
} from "./guards/email-validator";
export {
	normalizeTextForMatch,
	verifyQuoteAgainstSource,
} from "./guards/quote-verifier";
