'use strict';

var expect = require('expect.js');
var BluebirdPromise = require('bluebird');
var _ = require('lodash');

var mockKnex = require('mock-knex');
var knex = require('knex')({});
mockKnex.mock(knex);

var plugin = require('../lib/index.js');
var SanityError = require('../lib/errors.js').BookshelfAdvancedSerializationPluginSanityError;

var stubs = require('./_stubs.js');

describe('Plugin', function() {
  describe('options', function() {
    it('should accept not passing an options argument', function() {
      expect(function() {
        plugin();
      }).to.not.throwException();
    });
    it('should accept an options argument that is an object', function() {
      expect(function() {
        plugin({});
      }).to.not.throwException();
    });
    it('should reject a truthy options argument that is not an object', function() {
      expect(function() {
        plugin('foo');
      }).to.throwException(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('Truthy options argument passed to plugin must be an object.');
      });
    });
    describe('options.getEvaluatorArguments', function() {
      it('should accept not passing the option', function() {
        expect(function() {
          plugin({});
        }).to.not.throwException();
      });
      it('should accept passing a function', function() {
        expect(function() {
          plugin({ getEvaluatorArguments: function() {} });
        }).to.not.throwException();
      });
      it('should reject passing something truthy that is not a function', function() {
        expect(function() {
          plugin({ getEvaluatorArguments: 'foo' });
        }).to.throwException(function(e) {
          expect(e).to.be.a(SanityError);
          expect(e.message).to.equal('Truthy getEvaluatorArguments passed as plugin option must be a function.');
        });
      });
    });
    describe('options.handleEnsureRelation', function() {
      it('should accept not passing the option', function() {
        expect(function() {
          plugin({});
        }).to.not.throwException();
      });
      it('should accept passing a function', function() {
        expect(function() {
          plugin({
            handleEnsureRelation: function() {}
          });
        }).to.not.throwException();
      });
      it('should reject passing something truthy that is not a function', function() {
        expect(function() {
          plugin({ handleEnsureRelation: 'foo' });
        }).to.throwException(function(e) {
          expect(e).to.be.a(SanityError);
          expect(e.message).to.equal('Truthy handleEnsureRelation passed as plugin option must be a function.');
        });
      });
    });
    describe('options.ensureRelationsVisibleAndInvisible', function() {
      it('should accept not passing the option', function() {
        expect(function() {
          plugin({});
        }).to.not.throwException();
      });
      it('should accept passing `true`', function() {
        expect(function() {
          plugin({ ensureRelationsVisibleAndInvisible: true });
        }).to.not.throwException();
      });
      it('should accept passing `false`', function() {
        expect(function() {
          plugin({ ensureRelationsVisibleAndInvisible: false });
        }).to.not.throwException();
      });
      it('should reject a value that is not a boolean', function() {
        expect(function() {
          plugin({ ensureRelationsVisibleAndInvisible: 'true' });
        }).to.throwException(function(e) {
          expect(e).to.be.a(SanityError);
          expect(e.message).to.equal('ensureRelationsVisibleAndInvisible option must be a boolean.');
        });
      });
    });
  });
});

describe('Model', function() {
  var bookshelf = require('bookshelf')(knex);
  bookshelf.plugin('registry');
  bookshelf.plugin(plugin());

  var User = require('../examples/rest-api/User.js')(bookshelf);
  var Comment = require('../examples/rest-api/Comment.js')(bookshelf);

  var fetchElephant1LoadGroupsMemberOf = function(query) {
    return [
      function() {
        query.response([ stubs.users.elephant1 ]);
      },
      function() {
        query.response([
          _.extend({}, stubs.groups.slouchyGauchos, {
            _pivot_user_id: stubs.users.elephant1.id,
            _pivot_group_id: stubs.groups.slouchyGauchos.id
          })
        ]);
      }
    ];
  };

  describe('accessor', function() {
    it('should default to setting an undefined _accessor', function() {
      var user = User.forge();
      expect(user.hasOwnProperty('_accessor')).to.equal(true);
      expect(user._accessor).to.equal(undefined);
    });
  });
  describe('setAccessor', function() {
    it('should set the passed value as _accessor', function() {
      var user = User.forge({});
      user.setAccessor({ user: 'foo' });
      expect(user._accessor).to.eql({ user: 'foo' });
    });
  });
  describe('_accessedAsRelationChain', function() {
    it('should default to setting an empty relation chain', function() {
      var user = User.forge();
      expect(user._accessedAsRelationChain).to.eql([]);
    });
  });
  describe('roleDeterminer', function() {
    var model = bookshelf.Model.extend({ tableName: 'foo' }).forge({
      test: 123
    });
    it('should default to not setting a roleDeterminer method', function() {
      expect(model.roleDeterminer).to.equal(undefined);
    });
    it('should fail to serialize a model lacking a roleDeterminer method', function() {
      expect(function() {
        model.toJSON({});
      }).to.throwException(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('roleDeterminer function was not defined for models of table: foo');
      });
    });
  });
  describe('rolesToVisibleFields', function() {
    var model = bookshelf.Model.extend({
      tableName: 'foo',
      roleDeterminer: function(accessor) {
        return 'bar';
      }
    }).forge();
    it('should default to not setting a rolesToVisibleFields dictionary', function() {
      expect(model.rolesToVisibleFields).to.equal(undefined);
    });
    it('should fail to serialize a model lacking a rolesToVisibleFields dictionary', function() {
      expect(function() {
        model.toJSON({});
      }).to.throwException(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('rolesToVisibleFields was not defined for models of table: foo');
      });
    });
  });
  describe('constructor', function() {
    it('should allow setting _accessor via an option passed to .forge()', function() {
      var user = User.forge({}, { accessor: { user: 'foo' }});
      expect(user._accessor).to.eql({ user: 'foo' });
    });
  });
  describe('fetch', function() {
    var tracker = mockKnex.getTracker();
    beforeEach(function() {
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        fetchElephant1LoadGroupsMemberOf(query)[step - 1]();
      });
    });
    afterEach(function() {
      tracker.uninstall();
    });
    it('should transfer _accessor to a relation loaded via the `withRelated` option', function(done) {
      User.forge({ username: 'elephant1' }, { accessor: { user: 'foo' }})
        .fetch({ withRelated: 'groupsMemberOf' })
        .then(function(user) {
          var groups = user.related('groupsMemberOf');
          expect(groups.length).to.equal(1);
          groups.each(function(group) {
            expect(group._accessor).to.eql({ user: 'foo' });
          });
          done();
        });
    });
    it('should transfer _accessedAsRelationChain to a relation loaded via the `withRelated` option', function(done) {
      User.forge({ username: 'elephant1' }, { accessor: { user: 'foo' }})
        .fetch({ withRelated: 'groupsMemberOf' })
        .then(function(user) {
          var groups = user.related('groupsMemberOf');
          expect(groups.length).to.equal(1);
          var group = groups.at(0);
          expect(user._accessedAsRelationChain).to.eql([]);
          expect(group._accessedAsRelationChain).to.eql([ 'groupsMemberOf' ]);
          done();
        });
    });
  });
  describe('fetchAll', function() {
    var tracker = mockKnex.getTracker();
    before(function() {
      tracker.install();
      tracker.on('query', function sendResult(query) {
        query.response([
          stubs.users.elephant1,
          stubs.users.antelope99
        ]);
      });
    });
    after(function() {
      tracker.uninstall();
    });
    it('should set _accessor on all models in a collection fetched via fetchAll', function(done) {
      var user = User.forge({}, { accessor: { user: 'foo' }});
      user.fetchAll().then(function(collection) {
        expect(collection.length).to.equal(2);
        collection.each(function(model) {
          expect(model._accessor).to.eql({ user: 'foo' });
        })
        done();
      });
    });
  });
  describe('toJSON', function() {
    it('should return a promise resolving to the serialization result', function(done) {
      var serializationResultPromise = User.forge({ username: 'foo' }, {
        accessor: { user: 'bar' }
      }).toJSON();
      expect(serializationResultPromise).to.be.a(BluebirdPromise);
      serializationResultPromise.then(function(result) {
        expect(result).to.eql({ username: 'foo' });
        done();
      });
    });
    it('should reject a visibleFields that is not an array', function(done) {
      var model = bookshelf.Model.extend({
        tableName: 'foo',
        roleDeterminer: function() { return 'anyone'; },
        rolesToVisibleFields: { anyone: { username: true } }
      }).forge({
        test: 123
      });
      var serializationResultPromise = model.toJSON().catch(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('rolesToVisibleFields for table foo ' +
          'does not contain array of visible fields for role: anyone');
        done();
      });
    });
    it('should resolve a model with no role visible fields as undefined', function(done) {
      var model = bookshelf.Model.extend({
        tableName: 'foo',
        roleDeterminer: function() { return 'anyone'; },
        rolesToVisibleFields: { anyone: [] }
      }).forge({
        test: 123
      });
      var serializationResultPromise = model.toJSON().then(function(result) {
        expect(result).to.equal(undefined);
        done();
      });
    });
    it('should successfully serialize a model that uses role visible fields only', function(done) {
      var model = User.forge(stubs.users.elephant1, {
        accessor: { user: { id: stubs.users.antelope99.id } }
      });
      var serializationResultPromise = model.toJSON().then(function(result) {
        expect(result).to.eql({
          id: '3fe94198-7b32-44ee-abdd-04104b902c51',
          username: 'elephant1',
          created_at: '2016-01-03T04:07:51.690Z'
          // email excluded because it's not a visible property for requesting
          // user who is not the user being requested
        });
        done();
      });
    });
    describe('options', function() {
      describe('evaluator', function() {
        it('should require a truthy evaluator to be a function', function() {

        });
        it('should invoke evaluator with tableName, _accessedAsRelationChain, and model id as default arguments', function() {

        });
        it('should return a promise so that evaluator methods may do async work if they want to', function() {

        });
        it('should support providing a custom function for generating the arguments passed to the evaluator function', function() {

        });
      });
      describe('ensureRelationsLoaded', function() {
        it('should allow ensureRelationsLoaded to be falsy', function() {

        });
        it('should require truthy ensureRelationsLoaded to be an object', function() {

        });
        it('should handle as normally a table name that is not present in ensureRelationsLoaded', function() {

        });
        it('should support ensureRelationsLoaded[tableName] being an array', function() {

        });
        it('should require an evaluator function if ensureRelationsLoaded[tableName] is an object', function() {

        });
        it('should support ensureRelationsLoaded[tableName] being an object and use the designation returned by the evaluator function', function() {

        });
        it('should require that ensureRelationsLoaded[tableName][designation] be an array', function() {

        });
        it('should support custom handling of relation names to be loaded', function() {

        });
        it('should respect a `true` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function() {

        });
        it('should respect a `false` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function() {

        });
        it('should log about loading unnecessary relations if not in production env, when options.ensureRelationsVisibleAndInvisible is true', function() {

        });
        it('should log about loading unnecessary relations if not in production env, when options.ensureRelationsVisibleAndInvisible is false', function() {

        });
        it('should not log about loading unnecessary relations if in production env, when options.ensureRelationsVisibleAndInvisible is true', function() {

        });
        it('should not log about loading unnecessary relations if in production env, when options.ensureRelationsVisibleAndInvisible is false', function() {

        });
      });
      describe('contextSpecificVisibleFields', function() {
        it('should allow contextSpecificVisibleFields to be falsy', function() {

        });
        it('should require truthy contextSpecificVisibleFields to be an object', function() {

        });
        it('should handle as normally a table name that is not present in contextSpecificVisibleFields', function() {

        });
        it('should support contextSpecificVisibleFields[tableName] being an array', function() {

        });
        it('should require an evaluator function if contextSpecificVisibleFields[tableName] is an object', function() {

        });
        it('should support contextSpecificVisibleFields[tableName] being an object and use the designation returned by the evaluator function', function() {

        });
        it('should require contextSpecificVisibleFields[tableName][designation] to be an array', function() {

        });
        it('should calculate visible fields as the intersection of the role visible fields and the context-specific visible fields', function() {

        });
        it('should resolve models with no ultimately visible fields as undefined', function() {

        });
      });
      describe('shallow', function() {
        it('should respect `shallow: true` which Bookshelf by default supports', function() {

        });
      });
      describe('omitPivot', function() {
        it('should respect `omitPivot: true` which Bookshelf by default supports', function() {

        });
      });
    });
    it('should remove relations from the model that do not need to be serialized, which can be important to prevent infinite looping', function(done) {
      var tracker = mockKnex.getTracker();
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        fetchElephant1LoadGroupsMemberOf(query)[step - 1]()
      });

      User.forge({ username: 'elephant1' }, {
        accessor: { user: { id: stubs.users.elephant1.id } }
      })
      .fetch()
      .then(function(model) {
        model.load('groupsMemberOf').then(function() {
          expect(model.relations.hasOwnProperty('groupsMemberOf')).to.equal(true);
          model.toJSON({
            contextSpecificVisibleFields: {
              users: [ 'id', 'username', 'email', 'created_at' ]
            }
          }).then(function(result) {
            expect(model.relations.hasOwnProperty('groupsMemberOf')).to.equal(false);

            tracker.uninstall();
            done();
          });
        });
      });
    });
    it('in properties that are relations that are arrays (i.e. collections), should remove `undefined`s', function(done) {
      var tracker = mockKnex.getTracker();
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        var determineRole = [
          // Role determiner evaluation of admins
          function() {
            query.response([]);
          },
          // Role determiner evaluation of members
          function() {
            query.response([
              _.extend({}, stubs.users.elephant1, {
                _pivot_user_id: stubs.users.elephant1.id,
                _pivot_group_id: stubs.groups.slouchyGauchos.id
              })
            ]);
          }
        ];
        (
          fetchElephant1LoadGroupsMemberOf(query)
            .concat(determineRole)
            .concat(determineRole) // Necessary for the second call of .toJSON(),
            // because `admins` and `members` relations were deleted after first
            // call of .toJSON() because they were not visible properties
        )[step - 1]();
      });

      User.forge({ username: 'elephant1' }, {
        accessor: { user: { id: stubs.users.elephant1.id } }
      })
      .fetch()
      .then(function(model) {
        model.load('groupsMemberOf').then(function() {
          var groups = model.related('groupsMemberOf'); // Need to call this because
          // .related() is what transfers model._accessor to the relation
          model.toJSON({
            contextSpecificVisibleFields: {
              groups: [ 'id', 'name' ]
            }
          }).then(function(result) {
            expect(result).to.eql({
              id: '3fe94198-7b32-44ee-abdd-04104b902c51',
              username: 'elephant1',
              email: 'elephant1@example.com',
              created_at: '2016-01-03T04:07:51.690Z',
              groupsMemberOf: [{
                id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
                name: 'Slouchy gauchos'
              }]
            });

            model.toJSON({
              contextSpecificVisibleFields: {
                groups: []
              }
            }).then(function(result) {
              expect(result).to.eql({
                id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                username: 'elephant1',
                email: 'elephant1@example.com',
                created_at: '2016-01-03T04:07:51.690Z',
                groupsMemberOf: []
              });

              tracker.uninstall();
              done();
            });
          });
        });
      });
    });
    it('in properties that are relations that are arrays (i.e. collections), should wait for all promises to be resolved', function(done) {
      var tracker = mockKnex.getTracker();
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        var determineRole = [
          // Role determiner evaluation of admins
          function() {
            query.response([]);
          },
          // Role determiner evaluation of members
          function() {
            query.response([
              _.extend({}, stubs.users.elephant1, {
                _pivot_user_id: stubs.users.elephant1.id,
                _pivot_group_id: stubs.groups.slouchyGauchos.id
              })
            ]);
          }
        ];
        fetchElephant1LoadGroupsMemberOf(query).concat(determineRole)[step - 1]();
      });

      User.forge({ username: 'elephant1' }, {
        accessor: { user: { id: stubs.users.elephant1.id } }
      })
      .fetch()
      .then(function(model) {
        model.load('groupsMemberOf').then(function() {
          var groups = model.related('groupsMemberOf'); // Need to call this because
          // .related() is what transfers model._accessor to the relation
          model.toJSON({
            contextSpecificVisibleFields: {
              groups: [ 'id', 'name' ]
            }
          }).then(function(result) {
            expect(result.groupsMemberOf).to.eql([{
              id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
              name: 'Slouchy gauchos'
            }]); // If relation arrays weren't resolved as a promise of all the
            // promises in the array, this array would be an array containing a
            // serialized promise. Because this array contains an actual serialized
            // model rather than a serialized promise, this test proves the
            // desired functionality is implemented.

            tracker.uninstall();
            done();
          });
        });
      });
    });
    it('should convert a relation property with a value that would otherwise be serialized as an empty object to null', function(done) {
      // Cf. https://github.com/tgriesser/bookshelf/issues/753

      // Create an unplugged-in version of Bookshelf, for comparison
      var regularBookshelf = require('bookshelf')(knex);
      regularBookshelf.plugin('registry');
      var RegularComment = require('../examples/rest-api/Comment.js')(regularBookshelf);

      var configureTracker = function(tracker) {
        tracker.on('query', function sendResult(query, step) {
          [
            function() {
              query.response([
                stubs.comments[0]
              ]);
            },
            function() {
              query.response([]);
            }
          ][step - 1]();
        });
      };

      var tracker = mockKnex.getTracker();
      tracker.install();
      configureTracker(tracker);

      RegularComment.forge({ id: '8dc1464d-8c32-448d-a81d-ff161077d781' }, {
        accessor: { user: { id: stubs.users.elephant1.id } }
      })
      .fetch()
      .then(function(regularComment) {
        regularComment.load('author').then(function() {
          var regularResult = regularComment.toJSON();
          expect(regularResult).to.eql({
            id: '8dc1464d-8c32-448d-a81d-ff161077d781',
            author_id: '3fe94198-7b32-44ee-abdd-04104b902c51',
            author: {},
            content: 'Hello, World!'
          });

          tracker.uninstall();

          tracker = mockKnex.getTracker();
          tracker.install();
          configureTracker(tracker);

          Comment.forge({ id: '8dc1464d-8c32-448d-a81d-ff161077d781' }, {
            accessor: { user: { id: stubs.users.elephant1.id } }
          })
          .fetch()
          .then(function(comment) {
            comment.load('author').then(function() {
              var author = comment.related('author'); // Need to call this because
              // .related() is what transfers model._accessor to the relation

              comment.toJSON().then(function(result) {
                expect(result).to.eql({
                  id: '8dc1464d-8c32-448d-a81d-ff161077d781',
                  author: null,
                  content: 'Hello, World!'
                });

                tracker.uninstall();
                done();
              });
            });
          });
        });
      });
    });
  });
  describe('related', function() {
    var tracker = mockKnex.getTracker();
    beforeEach(function() {
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        fetchElephant1LoadGroupsMemberOf(query)[step - 1]();
      });
    });
    afterEach(function() {
      tracker.uninstall();
    });
    it('should transfer _accessor on the model to the relation loaded via .related()', function(done) {
      User.forge({ username: 'elephant1' }, { accessor: { user: 'foo' }}).fetch()
        .then(function(user) {
          user.load('groupsMemberOf').then(function() {
            var groups = user.related('groupsMemberOf');
            expect(groups.length).to.equal(1);
            groups.each(function(group) {
              expect(group._accessor).to.eql({ user: 'foo' });
            });
            done();
          });
        });
    });
    it('should transfer _accessedAsRelationChain to the related model and append to it the relation name', function(done) {
      User.forge({ username: 'elephant1' }, { accessor: { user: 'foo' }}).fetch()
        .then(function(user) {
          user.load('groupsMemberOf').then(function() {
            var groups = user.related('groupsMemberOf');
            expect(groups.length).to.equal(1);
            var group = groups.at(0);
            expect(user._accessedAsRelationChain).to.eql([]);
            expect(group._accessedAsRelationChain).to.eql([ 'groupsMemberOf' ]);
            done();
          });
        });
    });
  });
});

describe('Collection', function() {
  describe('serialize', function() {
    it('should wait for all promises in the collection to resolve', function() {

    });
    it('should remove undefineds from a serialized collection', function() {

    });
  });
  describe('toJSON', function() {
    it('should return a promise of a serialization result', function() {

    });
  });
});
