'use strict';

var BluebirdPromise = require('bluebird');

var relationPromise = function(model, relationName) {
  return model.relations[relationName] ?
    BluebirdPromise.resolve(model.related(relationName)) :
    model.load([ relationName ]).then(function(modelLoadedWithRelation) {
      return modelLoadedWithRelation.related(relationName);
    });
};

module.exports = function(bookshelf) {
  var Group = bookshelf.Model.extend({
    tableName: 'groups',
    hasTimestamps: true,

    roleDeterminer: function(accessor) {
      if (accessor.user) {
        var accessorId = accessor.user.id;

        var adminsCollectionPromise = relationPromise(this, 'admins');
        return adminsCollectionPromise.bind(this).then(function(adminsCollection) {
          var isAdmin = !!adminsCollection.find(function(admin) {
            return accessorId === admin.id;
          });
          if (isAdmin) {
            return 'admin';
          } else {

            var membersCollectionPromise = relationPromise(this, 'members');
            return membersCollectionPromise.then(function(membersCollection) {
              var isMember = !!membersCollection.find(function(member) {
                return accessorId === member.id;
              });
              if (isMember) {
                return 'member';
              } else {
                return 'outsider';
              }
            });
          }
        });
      } else {
        return 'outsider';
      }
    },
    rolesToVisibleProperties: {
      admin:    [ 'id', 'name', 'admins', 'members', 'created_at' ],
      member:   [ 'id', 'name', 'admins', 'members' ],
      outsider: []
    },

    admins: function() {
      return this.belongsToMany('User', 'group_admins', 'group_id', 'user_id');
    },
    members: function() {
      return this.belongsToMany('User', 'group_members', 'group_id', 'user_id');
    }
  }, {});

  // Register model
  if (!bookshelf.model('Group')) {
    bookshelf.model('Group', Group);
  }

  // Register model(s) depended on
  if (!bookshelf.model('User')) {
    require('./User.js')(bookshelf);
  }

  return bookshelf.model('Group');
};
