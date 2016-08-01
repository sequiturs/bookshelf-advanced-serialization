'use strict';

var BluebirdPromise = require('bluebird');

var bookshelf = require('./db.js');

require('./User.js');

var relationPromise = function(model, relationName) {
  return model.relations[relationName] ?
    BluebirdPromise.resolve(model.related(relationName)) :
    model.load([ relationName ]).then(function(modelLoadedWithRelation) {
      return modelLoadedWithRelation.related(relationName);
    });
};

var Group = bookshelf.Model.extend({
  tableName: 'groups',
  hasTimestamps: true,

  roleDeterminer: function(accessor) {
    if (accessor.user) {
      var accessorId = accessor.user.id;

      var adminsCollectionPromise = relationPromise(this, 'admins');
      return adminsCollectionPromise.then(function(adminsCollection) {
        var isAdmin = _.find(adminsCollection.models, function(admin) {
          return accessorId === admin.id;
        });
        if (isAdmin) {
          return 'admin';
        } else {

          var membersCollectionPromise = relationPromise(this, 'members');
          return membersCollectionPromise.then(function(membersCollection) {
            var isMember = _.find(membersCollection.models, function(member) {
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
  rolesToVisibleFields: {
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

module.exports = bookshelf.model('Group', Group);
