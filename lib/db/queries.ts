'use server';

import { desc, eq } from 'drizzle-orm';
import { withConnection, type DB } from '.';
import { auth } from '../auth/session';
import { activityLogs, teamMembers, teams, users } from './schema';

export async function getUser() {
  const session = await auth();
  if (!session?.user?.email) {
    return null;
  }

  return withConnection(async (db: DB) => {
    return db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
  });
}

export async function getTeamByStripeCustomerId(customerId: string) {
  return withConnection(async (db: DB) => {
    const result = await db
      .select()
      .from(teams)
      .where(eq(teams.stripeCustomerId, customerId))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  });
}

export async function updateTeamSubscription(
  teamId: number,
  subscriptionData: {
    stripeSubscriptionId: string | null;
    stripeProductId: string | null;
    planName: string | null;
    subscriptionStatus: string;
  }
) {
  return withConnection(async (db: DB) => {
    await db
      .update(teams)
      .set({
        ...subscriptionData,
        updatedAt: new Date(),
      })
      .where(eq(teams.id, teamId));
  });
}

export async function getUserWithTeam(userId: number) {
  return withConnection(async (db: DB) => {
    const result = await db
      .select({
        user: users,
        teamId: teamMembers.teamId,
      })
      .from(users)
      .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
      .where(eq(users.id, userId))
      .limit(1);

    return result[0];
  });
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return withConnection(async (db: DB) => {
    return await db
      .select({
        id: activityLogs.id,
        action: activityLogs.action,
        timestamp: activityLogs.timestamp,
        ipAddress: activityLogs.ipAddress,
        userName: users.name,
      })
      .from(activityLogs)
      .leftJoin(users, eq(activityLogs.userId, users.id))
      .where(eq(activityLogs.userId, user.id))
      .orderBy(desc(activityLogs.timestamp))
      .limit(10);
  });
}

export async function getTeamForUser(userId: number) {
  return withConnection(async (db: DB) => {
    const result = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        teamMembers: {
          with: {
            team: {
              with: {
                teamMembers: {
                  with: {
                    user: {
                      columns: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return result?.teamMembers[0]?.team || null;
  });
}
