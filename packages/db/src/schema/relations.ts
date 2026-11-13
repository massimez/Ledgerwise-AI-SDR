import { relations } from "drizzle-orm";
import { auditLog } from "./audit";
import {
	notification,
	notificationPreference,
	pushSubscription,
} from "./notification";
import {
	invitation,
	member,
	organization,
	organizationRole,
	organizationRolePermission,
} from "./organization";
import {
	agentRuns,
	companies,
	contacts,
	evidence,
	meetings,
	messages,
	qualificationCriteria,
	researchRuns,
	sdrSettings,
	suppressions,
	threads,
} from "./sdr";
import { account, session } from "./session";
import { organizationStorageLimits, storageFolders, uploads } from "./storage";
import { user } from "./user";

export const userRelations = relations(user, ({ many, one }) => ({
	accounts: many(account),
	auditLogs: many(auditLog),
	defaultOrganization: one(organization, {
		fields: [user.defaultOrganizationId],
		references: [organization.id],
	}),
	memberships: many(member),
	notificationPreferences: many(notificationPreference),
	notifications: many(notification),
	pushSubscriptions: many(pushSubscription),
	sentInvitations: many(invitation),
	sessions: many(session),
	uploads: many(uploads),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	activeOrganization: one(organization, {
		fields: [session.activeOrganizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const organizationRelations = relations(
	organization,
	({ many, one }) => ({
		agentRuns: many(agentRuns),
		companies: many(companies),
		contacts: many(contacts),
		evidence: many(evidence),
		invitations: many(invitation),
		meetings: many(meetings),
		members: many(member),
		messages: many(messages),
		notifications: many(notification),
		qualificationCriteria: many(qualificationCriteria),
		researchRuns: many(researchRuns),
		roles: many(organizationRole),
		sdrSettings: one(sdrSettings, {
			fields: [organization.id],
			references: [sdrSettings.organizationId],
		}),
		storageFolders: many(storageFolders),
		storageLimit: one(organizationStorageLimits, {
			fields: [organization.id],
			references: [organizationStorageLimits.organizationId],
		}),
		suppressions: many(suppressions),
		threads: many(threads),
		uploads: many(uploads),
	})
);

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	inviter: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
}));

export const organizationRoleRelations = relations(
	organizationRole,
	({ many, one }) => ({
		organization: one(organization, {
			fields: [organizationRole.organizationId],
			references: [organization.id],
		}),
		permissions: many(organizationRolePermission),
	})
);

export const organizationRolePermissionRelations = relations(
	organizationRolePermission,
	({ one }) => ({
		role: one(organizationRole, {
			fields: [organizationRolePermission.roleId],
			references: [organizationRole.id],
		}),
	})
);

export const organizationStorageLimitsRelations = relations(
	organizationStorageLimits,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationStorageLimits.organizationId],
			references: [organization.id],
		}),
	})
);

export const storageFoldersRelations = relations(
	storageFolders,
	({ many, one }) => ({
		children: many(storageFolders, { relationName: "folder_hierarchy" }),
		organization: one(organization, {
			fields: [storageFolders.organizationId],
			references: [organization.id],
		}),
		parent: one(storageFolders, {
			fields: [storageFolders.parentId],
			references: [storageFolders.id],
			relationName: "folder_hierarchy",
		}),
		uploads: many(uploads),
	})
);

export const uploadsRelations = relations(uploads, ({ one }) => ({
	folder: one(storageFolders, {
		fields: [uploads.folderId],
		references: [storageFolders.id],
	}),
	organization: one(organization, {
		fields: [uploads.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [uploads.userId],
		references: [user.id],
	}),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
	organization: one(organization, {
		fields: [notification.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [notification.userId],
		references: [user.id],
	}),
}));

export const notificationPreferenceRelations = relations(
	notificationPreference,
	({ one }) => ({
		user: one(user, {
			fields: [notificationPreference.userId],
			references: [user.id],
		}),
	})
);

export const pushSubscriptionRelations = relations(
	pushSubscription,
	({ one }) => ({
		user: one(user, {
			fields: [pushSubscription.userId],
			references: [user.id],
		}),
	})
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
	user: one(user, {
		fields: [auditLog.userId],
		references: [user.id],
	}),
}));

export const sdrSettingsRelations = relations(sdrSettings, ({ one }) => ({
	organization: one(organization, {
		fields: [sdrSettings.organizationId],
		references: [organization.id],
	}),
}));

export const researchRunsRelations = relations(researchRuns, ({ one }) => ({
	organization: one(organization, {
		fields: [researchRuns.organizationId],
		references: [organization.id],
	}),
	starter: one(user, {
		fields: [researchRuns.startedBy],
		references: [user.id],
	}),
}));

export const companiesRelations = relations(companies, ({ many, one }) => ({
	agentRuns: many(agentRuns),
	contacts: many(contacts),
	evidence: many(evidence),
	meetings: many(meetings),
	organization: one(organization, {
		fields: [companies.organizationId],
		references: [organization.id],
	}),
	qualificationCriteria: many(qualificationCriteria),
	suppressions: many(suppressions),
	threads: many(threads),
}));

export const evidenceRelations = relations(evidence, ({ one }) => ({
	company: one(companies, {
		fields: [evidence.companyId],
		references: [companies.id],
	}),
	organization: one(organization, {
		fields: [evidence.organizationId],
		references: [organization.id],
	}),
}));

export const qualificationCriteriaRelations = relations(
	qualificationCriteria,
	({ one }) => ({
		company: one(companies, {
			fields: [qualificationCriteria.companyId],
			references: [companies.id],
		}),
		organization: one(organization, {
			fields: [qualificationCriteria.organizationId],
			references: [organization.id],
		}),
	})
);

export const contactsRelations = relations(contacts, ({ many, one }) => ({
	company: one(companies, {
		fields: [contacts.companyId],
		references: [companies.id],
	}),
	meetings: many(meetings),
	organization: one(organization, {
		fields: [contacts.organizationId],
		references: [organization.id],
	}),
	sourceEvidence: one(evidence, {
		fields: [contacts.evidenceId],
		references: [evidence.id],
	}),
	threads: many(threads),
}));

export const threadsRelations = relations(threads, ({ many, one }) => ({
	agentRuns: many(agentRuns),
	company: one(companies, {
		fields: [threads.companyId],
		references: [companies.id],
	}),
	contact: one(contacts, {
		fields: [threads.contactId],
		references: [contacts.id],
	}),
	meetings: many(meetings),
	messages: many(messages),
	organization: one(organization, {
		fields: [threads.organizationId],
		references: [organization.id],
	}),
	owner: one(user, {
		fields: [threads.ownerUserId],
		references: [user.id],
	}),
}));

export const messagesRelations = relations(messages, ({ many, one }) => ({
	agentRuns: many(agentRuns),
	approver: one(user, {
		fields: [messages.approvedBy],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [messages.organizationId],
		references: [organization.id],
	}),
	thread: one(threads, {
		fields: [messages.threadId],
		references: [threads.id],
	}),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
	company: one(companies, {
		fields: [agentRuns.companyId],
		references: [companies.id],
	}),
	message: one(messages, {
		fields: [agentRuns.messageId],
		references: [messages.id],
	}),
	organization: one(organization, {
		fields: [agentRuns.organizationId],
		references: [organization.id],
	}),
	thread: one(threads, {
		fields: [agentRuns.threadId],
		references: [threads.id],
	}),
}));

export const suppressionsRelations = relations(suppressions, ({ one }) => ({
	company: one(companies, {
		fields: [suppressions.companyId],
		references: [companies.id],
	}),
	organization: one(organization, {
		fields: [suppressions.organizationId],
		references: [organization.id],
	}),
	sourceMessage: one(messages, {
		fields: [suppressions.sourceMessageId],
		references: [messages.id],
	}),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
	company: one(companies, {
		fields: [meetings.companyId],
		references: [companies.id],
	}),
	contact: one(contacts, {
		fields: [meetings.contactId],
		references: [contacts.id],
	}),
	organization: one(organization, {
		fields: [meetings.organizationId],
		references: [organization.id],
	}),
	thread: one(threads, {
		fields: [meetings.threadId],
		references: [threads.id],
	}),
}));
