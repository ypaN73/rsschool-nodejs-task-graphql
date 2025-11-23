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
import depthLimit from 'graphql-depth-limit';
import { UUIDType } from './types/uuid.js';

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
      resolve: async (profile: any, _, ctx) => {
        return ctx.db.memberType.findUnique({ where: { id: profile.memberTypeId } });
      }
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
      resolve: async (user: any, _, ctx) => {
        return ctx.db.profile.findUnique({ where: { userId: user.id } });
      }
    },
    posts: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostGQL))),
      resolve: async (user: any, _, ctx) => {
        return ctx.db.post.findMany({ where: { authorId: user.id } });
      }
    },
    userSubscribedTo: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: async (user: any, _, ctx) => {
        const subscriptions = await ctx.db.subscribersOnAuthors.findMany({
          where: { subscriberId: user.id },
          include: { author: true }
        });
        return subscriptions.map(sub => sub.author);
      }
    },
    subscribedToUser: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: async (user: any, _, ctx) => {
        const subscribers = await ctx.db.subscribersOnAuthors.findMany({
          where: { authorId: user.id },
          include: { subscriber: true }
        });
        return subscribers.map(sub => sub.subscriber);
      }
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
      resolve: (_, __, ctx) => ctx.db.memberType.findMany()
    },

    memberType: {
      type: MemberTypeGQL,
      args: { id: { type: new GraphQLNonNull(MemberTypeId) } },
      resolve: (_, { id }: { id: string }, ctx) =>
        ctx.db.memberType.findUnique({ where: { id } })
    },

    users: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserGQL))),
      resolve: (_, __, ctx) => ctx.db.user.findMany()
    },

    user: {
      type: UserGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx) =>
        ctx.db.user.findUnique({ where: { id } })
    },

    posts: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostGQL))),
      resolve: (_, __, ctx) => ctx.db.post.findMany()
    },

    post: {
      type: PostGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx) =>
        ctx.db.post.findUnique({ where: { id } })
    },

    profiles: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ProfileGQL))),
      resolve: (_, __, ctx) => ctx.db.profile.findMany()
    },

    profile: {
      type: ProfileGQL,
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: (_, { id }: { id: string }, ctx) =>
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
      resolve: (_, { dto }: { dto: { name: string; balance: number } }, ctx) =>
        ctx.db.user.create({ data: dto })
    },

    changeUser: {
      type: UserGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangeUserInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { name?: string; balance?: number } }, ctx) =>
        ctx.db.user.update({ where: { id }, data: dto })
    },

    deleteUser: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx) => {
        await ctx.db.user.delete({ where: { id } });
        return 'OK';
      }
    },

    createProfile: {
      type: ProfileGQL,
      args: { dto: { type: new GraphQLNonNull(CreateProfileInput) } },
      resolve: (_, { dto }: { dto: { isMale: boolean; yearOfBirth: number; userId: string; memberTypeId: string } }, ctx) =>
        ctx.db.profile.create({ data: dto })
    },

    changeProfile: {
      type: ProfileGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangeProfileInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { isMale?: boolean; yearOfBirth?: number; memberTypeId?: string } }, ctx) =>
        ctx.db.profile.update({ where: { id }, data: dto })
    },

    deleteProfile: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx) => {
        await ctx.db.profile.delete({ where: { id } });
        return 'OK';
      }
    },

    createPost: {
      type: PostGQL,
      args: { dto: { type: new GraphQLNonNull(CreatePostInput) } },
      resolve: (_, { dto }: { dto: { title: string; content: string; authorId: string } }, ctx) =>
        ctx.db.post.create({ data: dto })
    },

    changePost: {
      type: PostGQL,
      args: {
        id: { type: new GraphQLNonNull(UUIDType) },
        dto: { type: new GraphQLNonNull(ChangePostInput) }
      },
      resolve: (_, { id, dto }: { id: string; dto: { title?: string; content?: string } }, ctx) =>
        ctx.db.post.update({ where: { id }, data: dto })
    },

    deletePost: {
      type: new GraphQLNonNull(GraphQLString),
      args: { id: { type: new GraphQLNonNull(UUIDType) } },
      resolve: async (_, { id }: { id: string }, ctx) => {
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
      resolve: async (_, { userId, authorId }: { userId: string; authorId: string }, ctx) => {
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
      resolve: async (_, { userId, authorId }: { userId: string; authorId: string }, ctx) => {
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
          contextValue: { db: fastify.prisma }
        });

        return result;
      } catch (error) {
        return { errors: [error] };
      }
    },
  });
};

export default plugin;