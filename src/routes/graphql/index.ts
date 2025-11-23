import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createGqlResponseSchema, gqlResponseSchema } from './schemas.js';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLFloat,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLInputObjectType,
  graphql,
  parse,
  validate,
} from 'graphql';
import DataLoader from 'dataloader';
import { parseResolveInfo } from 'graphql-parse-resolve-info';
import type { GraphQLResolveInfo } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { UUIDType } from './types/uuid.js';

// ===== CONTEXT INTERFACES =====
interface GraphQLContext {
  db: any;
  dataLoaders: DataLoaderManager;
}

class DataLoaderManager {
  constructor(private prisma: any) { }

  readonly profileLoader = new DataLoader<string, any | null>(async (userIds) => {
    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: [...userIds] } }
    });
    const profileMap = new Map(profiles.map((p: any) => [p.userId, p]));
    return userIds.map(id => profileMap.get(id) ?? null);
  });

  readonly postLoader = new DataLoader<string, any[]>(async (authorIds) => {
    const posts = await this.prisma.post.findMany({
      where: { authorId: { in: [...authorIds] } }
    });
    const postMap = new Map<string, any[]>();
    posts.forEach((post: any) => {
      const existing = postMap.get(post.authorId) ?? [];
      postMap.set(post.authorId, [...existing, post]);
    });
    return authorIds.map(id => postMap.get(id) ?? []);
  });

  readonly memberTypeLoader = new DataLoader<string, any | null>(async (typeIds) => {
    const uniqueIds = [...new Set(typeIds)];
    const types = await this.prisma.memberType.findMany({
      where: { id: { in: uniqueIds } }
    });
    const typeMap = new Map(types.map((t: any) => [t.id, t]));
    return typeIds.map(id => typeMap.get(id) ?? null);
  });

  readonly userSubscribedToLoader = new DataLoader<string, any[]>(async (userIds) => {
    const subscriptions = await this.prisma.subscribersOnAuthors.findMany({
      where: { subscriberId: { in: [...userIds] } },
      include: { author: true }
    });
    const subscriptionMap = new Map<string, any[]>();
    subscriptions.forEach((sub: any) => {
      const existing = subscriptionMap.get(sub.subscriberId) ?? [];
      subscriptionMap.set(sub.subscriberId, [...existing, sub.author]);
    });
    return userIds.map(id => subscriptionMap.get(id) ?? []);
  });

  readonly subscribedToUserLoader = new DataLoader<string, any[]>(async (userIds) => {
    const subscribers = await this.prisma.subscribersOnAuthors.findMany({
      where: { authorId: { in: [...userIds] } },
      include: { subscriber: true }
    });
    const subscriberMap = new Map<string, any[]>();
    subscribers.forEach((sub: any) => {
      const existing = subscriberMap.get(sub.authorId) ?? [];
      subscriberMap.set(sub.authorId, [...existing, sub.subscriber]);
    });
    return userIds.map(id => subscriberMap.get(id) ?? []);
  });
}

// ===== GRAPHQL TYPES =====
const MemberTypeId = new GraphQLEnumType({
  name: 'MemberTypeId',
  values: {
    BASIC: { value: 'BASIC' },
    BUSINESS: { value: 'BUSINESS' }
  }
});

const MemberTypeGQL = new GraphQLObjectType({
  name: 'MemberType',
  fields: () => ({
    id: { type: new GraphQLNonNull(MemberTypeId) },
    discount: { type: new GraphQLNonNull(GraphQLFloat) },
    postsLimitPerMonth: { type: new GraphQLNonNull(GraphQLInt) }
  })
});

const PostGQL = new GraphQLObjectType({
  name: 'Post',
  fields: () => ({
    id: { type: new GraphQLNonNull(UUIDType) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    content: { type: new GraphQLNonNull(GraphQLString) }
  })
});

const ProfileGQL = new GraphQLObjectType({
  name: 'Profile',
  fields: () => ({
    id: { type: new GraphQLNonNull(UUIDType) },
    isMale: { type: new GraphQLNonNull(GraphQLBoolean) },
    yearOfBirth: { type: new GraphQLNonNull(GraphQLInt) },
    memberType: {
      type: new GraphQLNonNull(MemberTypeGQL),
      resolve: (profile: any, _, ctx: GraphQLContext) =>
        ctx.dataLoaders.memberTypeLoader.load(profile.memberTypeId)
    }
  })
});

const UserGQL = new GraphQLObjectType({
  name: 'User',
  fields: () => ({
    id: { type: new GraphQLNonNull(UUIDType) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    balance: { type: new GraphQLNonNull(GraphQLFloat) },
    profile: {
      type: ProfileGQL,
      resolve: (user: any, _, ctx: GraphQLContext) =>
        ctx.dataLoaders.profileLoader.load(user.id)
    },
    posts: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostGQL))),
      resolve: (user: any, _, ctx: GraphQLContext) =>
        ctx.dataLoaders.postLoader.load(user.id)
    },
    userSubscribedTo: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: (user: any, _, ctx: GraphQLContext) =>
        ctx.dataLoaders.userSubscribedToLoader.load(user.id)
    },
    subscribedToUser: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: (user: any, _, ctx: GraphQLContext) =>
        ctx.dataLoaders.subscribedToUserLoader.load(user.id)
    }
  })
});

// ===== INPUT TYPES =====
const CreateUserInput = new GraphQLInputObjectType({
  name: 'CreateUserInput',
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    balance: { type: new GraphQLNonNull(GraphQLFloat) }
  }
});

const ChangeUserInput = new GraphQLInputObjectType({
  name: 'ChangeUserInput',
  fields: {
    name: { type: GraphQLString },
    balance: { type: GraphQLFloat }
  }
});

const CreateProfileInput = new GraphQLInputObjectType({
  name: 'CreateProfileInput',
  fields: {
    isMale: { type: new GraphQLNonNull(GraphQLBoolean) },
    yearOfBirth: { type: new GraphQLNonNull(GraphQLInt) },
    userId: { type: new GraphQLNonNull(UUIDType) },
    memberTypeId: { type: new GraphQLNonNull(MemberTypeId) }
  }
});

const ChangeProfileInput = new GraphQLInputObjectType({
  name: 'ChangeProfileInput',
  fields: {
    isMale: { type: GraphQLBoolean },
    yearOfBirth: { type: GraphQLInt },
    memberTypeId: { type: MemberTypeId }
  }
});

const CreatePostInput = new GraphQLInputObjectType({
  name: 'CreatePostInput',
  fields: {
    title: { type: new GraphQLNonNull(GraphQLString) },
    content: { type: new GraphQLNonNull(GraphQLString) },
    authorId: { type: new GraphQLNonNull(UUIDType) }
  }
});

const ChangePostInput = new GraphQLInputObjectType({
  name: 'ChangePostInput',
  fields: {
    title: { type: GraphQLString },
    content: { type: GraphQLString }
  }
});

// ===== ROOT QUERY =====
const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    memberTypes: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(MemberTypeGQL))),
      resolve: (_, __, ctx: GraphQLContext) => ctx.db.memberType.findMany()
    },

    memberType: {
      type: MemberTypeGQL,
      args: { id: { type: new GraphQLNonNull(MemberTypeId) } },
      resolve: (_, { id }: { id: string }, ctx: GraphQLContext) =>
        ctx.db.memberType.findUnique({ where: { id } })
    },

    users: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: (_, __, ctx: GraphQLContext) => ctx.db.user.findMany()
    },

    user: {
      type: UserGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx: GraphQLContext) =>
        ctx.db.user.findUnique({ where: { id } })
    },

    posts: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostGQL))),
      resolve: (_, __, ctx: GraphQLContext) => ctx.db.post.findMany()
    },

    post: {
      type: PostGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx: GraphQLContext) =>
        ctx.db.post.findUnique({ where: { id } })
    },

    profiles: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ProfileGQL))),
      resolve: (_, __, ctx: GraphQLContext) => ctx.db.profile.findMany()
    },

    profile: {
      type: ProfileGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx: GraphQLContext) =>
        ctx.db.profile.findUnique({ where: { id } })
    }
  }
});

// ===== MUTATION RESOLVERS =====
const MutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    createUser: {
      type: UserGQL,
      args: { dto: { type: new GraphQLNonNull(CreateUserInput) } },
      resolve: (_, { dto }: { dto: { name: string; balance: number } }, ctx: GraphQLContext) =>
        ctx.db.user.create({ data: dto })
    },

    changeUser: {
      type: UserGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangeUserInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { name?: string; balance?: number } }, ctx: GraphQLContext) =>
        ctx.db.user.update({ where: { id }, data: dto })
    },

    deleteUser: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx: GraphQLContext) => {
        await ctx.db.user.delete({ where: { id } });
        return 'OK';
      }
    },

    createProfile: {
      type: ProfileGQL,
      args: { dto: { type: new GraphQLNonNull(CreateProfileInput) } },
      resolve: (_, { dto }: { dto: { isMale: boolean; yearOfBirth: number; userId: string; memberTypeId: string } }, ctx: GraphQLContext) =>
        ctx.db.profile.create({ data: dto })
    },

    changeProfile: {
      type: ProfileGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangeProfileInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { isMale?: boolean; yearOfBirth?: number; memberTypeId?: string } }, ctx: GraphQLContext) =>
        ctx.db.profile.update({ where: { id }, data: dto })
    },

    deleteProfile: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx: GraphQLContext) => {
        await ctx.db.profile.delete({ where: { id } });
        return 'OK';
      }
    },

    createPost: {
      type: PostGQL,
      args: { dto: { type: new GraphQLNonNull(CreatePostInput) } },
      resolve: (_, { dto }: { dto: { title: string; content: string; authorId: string } }, ctx: GraphQLContext) =>
        ctx.db.post.create({ data: dto })
    },

    changePost: {
      type: PostGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangePostInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { title?: string; content?: string } }, ctx: GraphQLContext) =>
        ctx.db.post.update({ where: { id }, data: dto })
    },

    deletePost: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx: GraphQLContext) => {
        await ctx.db.post.delete({ where: { id } });
        return 'OK';
      }
    },

    subscribeTo: {
      type: new GraphQLNonNull(GraphQLString),
      args: {
        userId: { type: new GraphQLNonNull(UUIDType) },
        authorId: { type: new GraphQLNonNull(UUIDType) }
      },
      resolve: async (_, { userId, authorId }: { userId: string; authorId: string }, ctx: GraphQLContext) => {
        await ctx.db.subscribersOnAuthors.create({
          data: { subscriberId: userId, authorId }
        });
        return 'OK';
      }
    },

    unsubscribeFrom: {
      type: new GraphQLNonNull(GraphQLString),
      args: {
        userId: { type: new GraphQLNonNull(UUIDType) },
        authorId: { type: new GraphQLNonNull(UUIDType) }
      },
      resolve: async (_, { userId, authorId }: { userId: string; authorId: string }, ctx: GraphQLContext) => {
        await ctx.db.subscribersOnAuthors.delete({
          where: { subscriberId_authorId: { subscriberId: userId, authorId } }
        });
        return 'OK';
      }
    }
  }
});

// ===== SCHEMA DEFINITION =====
const graphqlSchema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType
});

// ===== FASTIFY PLUGIN =====
const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.route({
    url: '/',
    method: 'POST',
    schema: {
      ...createGqlResponseSchema,
      response: {
        200: gqlResponseSchema,
      },
    },
    async handler(req) {
      const { query, variables } = req.body;
      const context: GraphQLContext = {
        db: fastify.prisma,
        dataLoaders: new DataLoaderManager(fastify.prisma)
      };

      try {
        // Parse and validate query
        const parsedQuery = parse(query as string);
        const validationErrors = validate(graphqlSchema, parsedQuery, [depthLimit(5)]);

        if (validationErrors.length > 0) {
          return { errors: validationErrors };
        }

        // Execute GraphQL query
        const result = await graphql({
          schema: graphqlSchema,
          source: query as string,
          variableValues: variables,
          contextValue: context
        });

        return result;
      } catch (error) {
        return { errors: [error] };
      }
    },
  });
};

export default plugin;