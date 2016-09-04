'use strict';

var express = require('express');

var bookshelf = require('./db.js');

require('./User.js')(bookshelf);
require('./Group.js')(bookshelf);
require('./Comment.js')(bookshelf);

var app = express();

/**
 * Payload that `toJSON()` will resolve with looks like:
 * {
 *   id: '8dc1464d-8c32-448d-a81d-ff161077d781',
 *   author: {
 *     username: 'elephant1'
 *   },
 *   content: 'Hello, World!',
 *   parent: {
 *     id: '147fd60a-ed3a-4209-85b3-7a330caf3896',
 *     author: {
 *       username: 'antelope99'
 *     }
 *   },
 *   children: [
 *     {
 *       id: '5792d5d9-bef5-4b32-8d34-682b8caad67a',
 *       author: {
 *         username: 'gazelle22'
 *       }
 *     },
 *     ...
 *   ]
 * }
 */
app.get('/comments/:id', function(req, res) {
  bookshelf.model('Comment')
    .forge({
      id: req.params.id
    }, {
      accessor: { user: req.user }
    })
    .fetch()
    .then(function(comment) {
      return comment.toJSON({
        contextSpecificVisibleProperties: {
          comments: {
            requestedComment:       [ 'id', 'author', 'content', 'parent', 'children' ],
            requestedCommentParent: [ 'id', 'author' ],
            requestedCommentChild:  [ 'id', 'author' ]
          },
          users: [ 'username' ]
        },
        ensureRelationsLoaded: {
          comments: {
            requestedComment:       [ 'author', 'parent', 'children' ],
            requestedCommentParent: [ 'author' ],
            requestedCommentChild:  [ 'author' ]
          }
        },
        contextDesignator: function(tableName, relationChain, idOfModelBeingSerialized, parentIdOfModelBeingSerialized) {
          if (tableName === 'comments') {
            if (comment.id === idOfModelBeingSerialized) {
              return 'requestedComment';
            } else if (comment.get('parent_id') === idOfModelBeingSerialized) {
              return 'requestedCommentParent';
            } else if (comment.id === parentIdOfModelBeingSerialized) {
              return 'requestedCommentChild';
            }
          }
        }
      });
    })
    .then(function(data) {
      res.status(200).send(data);
    });
});

/**
 * Payload that `toJSON()` will resolve with depends on who the requesting user is.
 *
 * If the requesting user is authenticated as the user being requested:
 *
 * {
 *   id: '3d33e941-e23e-41fa-8807-03e87ce7baa8'
 *   username: 'antelope99'
 *   created_at: '2016-02-03T04:07:51.690Z',
 *   email: 'antelope99@example.com',
 *   groupsMemberOf: [
 *     {
 *       id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
 *       name: 'Slouchy gauchos'
 *       // This group object will not contain the `members` and `admins` relations,
 *       // because those were not specified in `ensureRelationsLoaded`.
 *     },
 *     ...
 *   ],
 *   groupsAdminOf: [
 *     {
 *       id: 'b0a94a70-2db7-4063-ad0d-0ef39412bfd2',
 *       name: 'Neo-Post-Tangential Economics Society',
 *       created_at: '2016-04-12T08:12:11.380Z'
 *     },
 *     ...
 *   ]
 * }
 *
 * If the requesting user is not authenticated as the user being requested:
 *
 * {
 *   id: '3d33e941-e23e-41fa-8807-03e87ce7baa8'
 *   username: 'antelope99'
 *   created_at: '2016-02-03T04:07:51.690Z'
 * }
 */
app.get('/users/:username', function(req, res) {
  bookshelf.model('User')
    .forge({
      username: req.params.username
    }, {
      accessor: { user: req.user }
    })
    .fetch()
    .then(function(user) {
      return user.toJSON({
        ensureRelationsLoaded: {
          users: [ 'groupsMemberOf', 'groupsAdminOf' ]
        }
      });
    })
    .then(function(data) {
      res.status(200).send(data);
    });
});

/**
 * Payload that `toJSON()` will resolve with depends on who the requesting user is.
 *
 * If requesting user is an admin of the requested group:
 *
 * {
 *   id: 'b0a94a70-2db7-4063-ad0d-0ef39412bfd2',
 *   name: 'Neo-Post-Tangential Economics Society',
 *   created_at: '2016-04-12T08:12:11.380Z'
 * }
 *
 * If requesting user is a member of the requested group:
 *
 * {
 *   id: 'b0a94a70-2db7-4063-ad0d-0ef39412bfd2',
 *   name: 'Neo-Post-Tangential Economics Society'
 * }
 *
 * If the requesting user is not a member or admin of the group:
 *
 * undefined
 *
 */
app.get('/groups/:id', function(req, res) {
  bookshelf.model('Group')
    .forge({
      id: req.params.id
    }, {
      accessor: { user: req.user }
    })
    .fetch()
    .then(function(group) {
      return group.toJSON();
    })
    .then(function(data) {
      res.status(200).send(data);
    });
});

app.listen(8080, function () {
  console.log('Server listening on http://localhost:8080, Ctrl+C to stop');
});
