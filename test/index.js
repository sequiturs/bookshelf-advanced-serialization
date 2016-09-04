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

        // Default behavior of `false` is tested below in Model > toJSON >
        // options > ensureRelationsLoaded.
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
  var determineRoleElephant1SlouchyGauchos = function(query) {
    return [
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
  describe('rolesToVisibleProperties', function() {
    var model = bookshelf.Model.extend({
      tableName: 'foo',
      roleDeterminer: function(accessor) {
        return 'bar';
      }
    }).forge();
    it('should default to not setting a rolesToVisibleProperties dictionary', function() {
      expect(model.rolesToVisibleProperties).to.equal(undefined);
    });
    it('should fail to serialize a model lacking a rolesToVisibleProperties dictionary', function() {
      expect(function() {
        model.toJSON({});
      }).to.throwException(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('rolesToVisibleProperties was not defined for models of table: foo');
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
    it('should reject a visibleProperties that is not an array', function(done) {
      var model = bookshelf.Model.extend({
        tableName: 'foo',
        roleDeterminer: function() { return 'anyone'; },
        rolesToVisibleProperties: { anyone: { username: true } }
      }).forge({
        test: 123
      });
      var serializationResultPromise = model.toJSON().catch(function(e) {
        expect(e).to.be.a(SanityError);
        expect(e.message).to.equal('rolesToVisibleProperties for table foo ' +
          'does not contain array of visible properties for role: anyone');
        done();
      });
    });
    it('should resolve a model with no role visible properties as undefined', function(done) {
      var model = bookshelf.Model.extend({
        tableName: 'foo',
        roleDeterminer: function() { return 'anyone'; },
        rolesToVisibleProperties: { anyone: [] }
      }).forge({
        test: 123
      });
      var serializationResultPromise = model.toJSON().then(function(result) {
        expect(result).to.equal(undefined);
        done();
      });
    });
    it('should successfully serialize a model that uses role visible properties only', function(done) {
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
      describe('contextDesignator', function() {
        it('should require a truthy contextDesignator to be a function', function(done) {
          User.forge({ username: 'foo' }, {
            accessor: { user: 'bar' }
          }).toJSON({
            contextDesignator: 'fizz'
          }).catch(function(e) {
            expect(e).to.be.a(SanityError);
            expect(e.message).to.equal('contextDesignator must be a function');
            done();
          });
        });
        it('should invoke contextDesignator with tableName, _accessedAsRelationChain, and model id as default arguments', function(done) {
          User.forge({ id: 1, username: 'foo' }, {
            accessor: { user: 'bar' }
          }).toJSON({
            contextDesignator: function(tableName, relationChain, id) {
              expect(tableName).to.equal('users');
              expect(relationChain).to.eql([]);
              expect(id).to.equal(1);
              done();
            }
          });
        });
        it('the return result of contextDesignator methods should be wrapped in a promise, so contextDesignator can do async work if it wants to', function(done) {
          User.forge({ id: 1, username: 'foo' }, {
            accessor: { user: 'bar' }
          }).toJSON({
            contextDesignator: function(tableName, relationChain, id) {
              return 'fizz';
            },
            contextSpecificVisibleProperties: {
              users: {
                fizz: [ 'username' ]
              }
            }
          }).then(function(result) {
            expect(result).to.eql({ username: 'foo' });

            User.forge({ id: 1, username: 'foo' }, {
              accessor: { user: 'bar' }
            }).toJSON({
              contextDesignator: function(tableName, relationChain, id) {
                return BluebirdPromise.resolve('fizz');
              },
              contextSpecificVisibleProperties: {
                users: {
                  fizz: [ 'username' ]
                }
              }
            }).then(function(result) {
              expect(result).to.eql({ username: 'foo' });

              done();
            });
          });
        });
        it('should support providing a custom function for generating the arguments passed to the contextDesignator function', function(done) {
          var anotherBookshelf = require('bookshelf')(knex);
          anotherBookshelf.plugin('registry');
          anotherBookshelf.plugin(plugin({
            getEvaluatorArguments: function() {
              return [ this.tableName, this.get('albumName') ];
            }
          }));

          anotherBookshelf.Model.extend({
            tableName: 'tunes',
            roleDeterminer: function() { return 'anyone'; },
            rolesToVisibleProperties: {
              anyone: [ 'id' ]
            }
          }).forge({
            id: 1,
            name: 'As I went out one morning',
            albumName: 'John Wesley Harding'
          }, {
            accessor: { user: 'bar' }
          }).toJSON({
            contextDesignator: function(tableName, albumName) {
              expect(tableName).to.equal('tunes');
              expect(albumName).to.equal('John Wesley Harding');
              done();
            }
          });
        });
      });

      // Share some sanity-checking test logic between ensureRelationsLoaded and
      // contextSpecificVisibleProperties.
      var sharedSanityChecking = function(property) {
        if (!(property === 'ensureRelationsLoaded' || property === 'contextSpecificVisibleProperties')) {
          throw new Error('Incorrect property passed to sharedSanityChecking');
        }

        describe('Shared sanity-checking test logic', function() {
          var tracker = mockKnex.getTracker();
          beforeEach(function(done) {
            tracker.install();
            tracker.on('query', function sendResult(query, step) {
              fetchElephant1LoadGroupsMemberOf(query)
                .concat(determineRoleElephant1SlouchyGauchos(query))[step - 1]()
            });
            done();
          });
          afterEach(function(done) {
            tracker.uninstall();
            done();
          });

          it('should allow ' + property + ' to be falsy', function(done) {
            var options = {};
            options[property] = null
            User.forge({ username: 'foo' }, {
              accessor: { user: 'bar' }
            }).toJSON(options).then(function(result) {
              done();
            });
          });
          it('should require truthy ' + property + ' to be an object', function(done) {
            var options = {};
            options[property] = 'fizz';
            User.forge({ username: 'foo' }, {
              accessor: { user: 'bar' }
            }).toJSON(options).catch(function(e) {
              expect(e).to.be.a(SanityError);
              expect(e.message).to.equal(property + ' must be an object');
              done();
            });
          });
          it('should handle as normally a table name that is not present in ' + property, function(done) {
            var options = {};
            options[property] = { comments: [ 'author' ] };
            User.forge({ username: 'foo' }, {
              accessor: { user: 'bar' }
            }).toJSON(options).then(function(result) {
              expect(result).to.eql({ username: 'foo' });
              done();
            });
          });
          it('should support ' + property + '[tableName] being an array', function(done) {
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                ensureRelationsLoaded: {
                  users: [ 'groupsMemberOf' ]
                },
                contextSpecificVisibleProperties: {
                  groups: [ 'name' ]
                }
              }).then(function(result) {
                expect(result).to.eql({
                  id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                  username: 'elephant1',
                  email: 'elephant1@example.com',
                  created_at: '2016-01-03T04:07:51.690Z',
                  groupsMemberOf: [{ name: 'Slouchy gauchos' }]
                });

                done();
              });
            });
          });
          it('should require an contextDesignator function if ' + property + '[tableName] is an object', function(done) {
            var options = {};
            options[property] = {
              users: { foo: [ 'groupsMemberOf' ] }
            };
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON(options).catch(function(e) {
                expect(e).to.be.a(SanityError);
                expect(e.message).to.equal('options must contain an contextDesignator function if ' +
                  'options.' + property + '[this.tableName] is an object');

                done();
              });
            });
          });
          it('should support ' + property + '[tableName] being an object and use the designation returned by the contextDesignator function', function(done) {
            var options = {
              contextDesignator: function(tableName, relationChain, id) {
                return 'foo';
              }
            };
            if (property === 'ensureRelationsLoaded') {
              options[property] = {
                users: { foo: [ 'groupsMemberOf' ] }
              };
              options.contextSpecificVisibleProperties = {
                groups: [ 'name' ]
              };
            } else if (property === 'contextSpecificVisibleProperties') {
              options[property] = {
                users: { foo: [ 'email' ] }
              };
            }
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON(options).then(function(result) {
                if (property === 'ensureRelationsLoaded') {
                  expect(result).to.eql({
                    id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                    username: 'elephant1',
                    email: 'elephant1@example.com',
                    created_at: '2016-01-03T04:07:51.690Z',
                    groupsMemberOf: [{ name: 'Slouchy gauchos' }]
                  });
                  done();
                } else if (property === 'contextSpecificVisibleProperties') {
                  expect(result).to.eql({
                    email: 'elephant1@example.com'
                  });
                  done();
                }
              });
            });
          });
          it('should reject ' + property + '[tableName] being neither array nor object', function(done) {
            var options = {
              contextDesignator: function(tableName, relationChain, id) {
                return 'foo';
              }
            };
            options[property] = {
              users: 'bar'
            };
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON(options).catch(function(e) {
                expect(e).to.be.a(SanityError);
                expect(e.message).to.equal(property + '.users ' +
                  'must be an array, or an object whose keys are strings returned ' +
                  'by the options.contextDesignator function and whose values are arrays.');

                done();
              });
            });
          });
          it('should require that ' + property + '[tableName][designation] be an array', function(done) {
            var options = {
              contextDesignator: function(tableName, relationChain, id) {
                return 'foo';
              }
            };
            options[property] = {
              users: { foo: { groupsMemberOf: true } }
            };
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON(options).catch(function(e) {
                expect(e).to.be.a(SanityError);
                expect(e.message).to.equal('contextDesignator function did not successfully ' +
                  'identify array within ' + property);

                done();
              });
            });
          });
        });
      };

      describe('ensureRelationsLoaded', function() {

        sharedSanityChecking('ensureRelationsLoaded');

        describe('Unique sanity-checking test logic', function() {
          var tracker = mockKnex.getTracker();
          beforeEach(function(done) {
            tracker.install();
            tracker.on('query', function sendResult(query, step) {
              fetchElephant1LoadGroupsMemberOf(query)
                .concat(determineRoleElephant1SlouchyGauchos(query))[step - 1]()
            });
            done();
          });
          afterEach(function(done) {
            tracker.uninstall();
            done();
          });

          it('should support custom handling of relation names to be loaded', function(done) {
            var anotherBookshelf = require('bookshelf')(knex);
            anotherBookshelf.plugin('registry');
            anotherBookshelf.plugin(plugin({
              handleEnsureRelation: function(relationName) {
                expect(relationName).to.equal('recordLabel');
                this.set('artistName', 'Bob Dylan');
              }
            }));

            anotherBookshelf.Model.extend({
              tableName: 'tunes',
              roleDeterminer: function() { return 'anyone'; },
              rolesToVisibleProperties: {
                anyone: [ 'id', 'name', 'albumName', 'artistName', 'recordLabel' ]
              }
            }).forge({
              id: 1,
              name: 'As I went out one morning',
              albumName: 'John Wesley Harding'
            }, {
              accessor: { user: 'bar' }
            }).toJSON({
              ensureRelationsLoaded: {
                tunes: [ 'recordLabel' ]
              }
            }).then(function(result) {
              expect(result).to.eql({
                id: 1,
                name: 'As I went out one morning',
                albumName: 'John Wesley Harding',
                artistName: 'Bob Dylan',
                // We don't expect `recordLabel` to be in the result, because our
                // custom `handleEnsureRelation` doesn't actually load that relation;
                // instead it sets the `artistName` attribute.
              });

              done();
            });
          });
          it('should respect a `true` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function(done) {
            var anotherBookshelf = require('bookshelf')(knex);
            anotherBookshelf.plugin('registry');
            anotherBookshelf.plugin(plugin({
              handleEnsureRelation: function(relationName) {
                expect(relationName).to.equal('groupsMemberOf');

                // Replicate default handleEnsureRelation functionality
                return this.relations[relationName] ?
                  BluebirdPromise.resolve(this.related(relationName)) :
                  this.load([ relationName ]).then(function(thisLoadedWithRelationName) {
                    return thisLoadedWithRelationName.related(relationName);
                  })
              },
              ensureRelationsVisibleAndInvisible: true
            }));

            var AnotherBookshelfUser = require('../examples/rest-api/User.js')(anotherBookshelf);
            AnotherBookshelfUser.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                ensureRelationsLoaded: {
                  users: [ 'groupsMemberOf' ]
                },
                contextSpecificVisibleProperties: {
                  users: [ 'id', 'username' ]
                }
              }).then(function(result) {
                expect(result).to.eql({
                  id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                  username: 'elephant1'
                });
                done();
              });
            });
          });
          it('should respect a `false` value of ensureRelationsVisibleAndInvisible when ensuring relations loaded', function(done) {
            var anotherBookshelf = require('bookshelf')(knex);
            anotherBookshelf.plugin('registry');
            anotherBookshelf.plugin(plugin({
              handleEnsureRelation: function(relationName) {
                done(new Error('handleEnsureRelation should not be called'));
              },
              ensureRelationsVisibleAndInvisible: false
            }));

            var AnotherBookshelfUser = require('../examples/rest-api/User.js')(anotherBookshelf);
            AnotherBookshelfUser.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                ensureRelationsLoaded: {
                  users: [ 'groupsMemberOf' ]
                },
                contextSpecificVisibleProperties: {
                  users: [ 'id', 'username' ]
                }
              }).then(function(result) {
                expect(result).to.eql({
                  id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                  username: 'elephant1'
                });
                done();
              });
            });
          });
          it('should default to behaving as if ensureRelationsVisibleAndInvisible is false when ensuring relations loaded', function(done) {
            var anotherBookshelf = require('bookshelf')(knex);
            anotherBookshelf.plugin('registry');
            anotherBookshelf.plugin(plugin({
              handleEnsureRelation: function(relationName) {
                done(new Error('handleEnsureRelation should not be called'));
              }
            }));

            var AnotherBookshelfUser = require('../examples/rest-api/User.js')(anotherBookshelf);
            AnotherBookshelfUser.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                ensureRelationsLoaded: {
                  users: [ 'groupsMemberOf' ]
                },
                contextSpecificVisibleProperties: {
                  users: [ 'id', 'username' ]
                }
              }).then(function(result) {
                expect(result).to.eql({
                  id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                  username: 'elephant1'
                });
                done();
              });
            });
          });
        });
      });
      describe('contextSpecificVisibleProperties', function() {

        sharedSanityChecking('contextSpecificVisibleProperties');

        describe('Unique sanity-checking test logic', function() {
          var tracker = mockKnex.getTracker();
          beforeEach(function(done) {
            tracker.install();
            tracker.on('query', function sendResult(query, step) {
              fetchElephant1LoadGroupsMemberOf(query)[step - 1]()
            });
            done();
          });
          afterEach(function(done) {
            tracker.uninstall();
            done();
          });

          it('should calculate visible properties as the intersection of the role visible properties and the context-specific visible properties', function(done) {
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                contextSpecificVisibleProperties: {
                  users: [ 'created_at', 'email' ]
                }
              }).then(function(result) {
                expect(result).to.eql({
                  email: 'elephant1@example.com',
                  created_at: '2016-01-03T04:07:51.690Z'
                });
                done();
              });
            });
          });
          it('should resolve models with no ultimately visible properties as undefined', function(done) {
            User.forge({ username: 'elephant1' }, {
              accessor: { user: { id: stubs.users.elephant1.id } }
            })
            .fetch()
            .then(function(model) {
              model.toJSON({
                contextSpecificVisibleProperties: {
                  users: [ 'shapes', 'sizes' ]
                }
              }).then(function(result) {
                expect(result === undefined).to.equal(true);
                done();
              });
            });
          });
        })
      });
      describe('shallow', function() {
        var tracker = mockKnex.getTracker();
        beforeEach(function(done) {
          tracker.install();
          tracker.on('query', function sendResult(query, step) {
            fetchElephant1LoadGroupsMemberOf(query)
              .concat(determineRoleElephant1SlouchyGauchos(query))[step - 1]()
          });
          done();
        });
        afterEach(function(done) {
          tracker.uninstall();
          done();
        });

        it('should respect `shallow: true` which Bookshelf by default supports', function(done) {
          User.forge({ username: 'elephant1' }, {
            accessor: { user: { id: stubs.users.elephant1.id } }
          })
          .fetch()
          .then(function(model) {
            model.toJSON({
              ensureRelationsLoaded: {
                users: [ 'groupsMemberOf' ]
              },
              contextSpecificVisibleProperties: {
                users: [ 'id', 'username', 'groupsMemberOf' ]
              },
              shallow: true
            }).then(function(result) {
              // We expect groupsMemberOf relation to have been loaded on the model,
              // but not be on the serialized result because `shallow: true` specifies
              // relations not to be serialized.
              expect(result).to.eql({
                id: '3fe94198-7b32-44ee-abdd-04104b902c51',
                username: 'elephant1'
              });
              expect(model.relations).to.have.key('groupsMemberOf');
              done();
            });
          });
        });
      });
      describe('omitPivot', function() {
        var regularBookshelf = require('bookshelf')(knex);
        regularBookshelf.plugin('registry');

        it('should respect `omitPivot: true` which Bookshelf by default supports', function(done) {
          var teachersModelDefinition = {
            tableName: 'teachers',
            roleDeterminer: function() { return 'anyone'; },
            rolesToVisibleProperties: { anyone: [ 'id', 'name', 'classesTeacherOf' ] },
            classesTeacherOf: function() {
              return this.belongsToMany('Class', 'class_teachers', 'teacher_id', 'class_id')
            }
          };
          var classesModelDefinition = {
            tableName: 'classes',
            roleDeterminer: function() { return 'anyone'; },
            rolesToVisibleProperties: { anyone: [ 'id', 'name', '_pivot_teacher_id', '_pivot_class_id' ] }
          };

          var teacherFixture = {
            id: 1,
            name: 'bert'
          };
          var classFixture = {
            id: 2,
            name: 'history',
            _pivot_teacher_id: 1,
            _pivot_group_id: 2
          };

          var mock = function(query, step) {
            [
              function() {
                query.response([teacherFixture]);
              },
              function() {
                query.response([classFixture]);
              }
            ][step - 1]()
          };

          var expectedJsonWithPivot = {
            id: 1,
            name: 'bert',
            classesTeacherOf: [ classFixture ]
          };
          var expectedJsonWithoutPivot = {
            id: 1,
            name: 'bert',
            classesTeacherOf: [{
              id: 2,
              name: 'history'
            }]
          };

          // Establish regular, unplugged-in Bookshelf behavior

          regularBookshelf.model('Teacher', regularBookshelf.Model.extend(teachersModelDefinition, {}));
          regularBookshelf.model('Class', regularBookshelf.Model.extend(classesModelDefinition, {}));

          var tracker = mockKnex.getTracker();
          tracker.install();
          tracker.on('query', mock);

          regularBookshelf.model('Teacher').forge({ name: 'bert' })
          .fetch()
          .then(function(model) {
            return model.load('classesTeacherOf').then(function() {

              var regularJson = model.toJSON();
              expect(regularJson).to.eql(expectedJsonWithPivot);

              var regularJsonOmitPivot = model.toJSON({ omitPivot: true });
              expect(regularJsonOmitPivot).to.eql(expectedJsonWithoutPivot);

              tracker.uninstall();
            });
          })
          .then(function() {

            // Establish same functionality for plugged-in bookshelf

            bookshelf.model('Teacher', bookshelf.Model.extend(teachersModelDefinition, {}));
            bookshelf.model('Class', bookshelf.Model.extend(classesModelDefinition, {}));

            var tracker = mockKnex.getTracker();
            tracker.install();
            tracker.on('query', mock);

            regularBookshelf.model('Teacher').forge({ name: 'bert' })
            .fetch()
            .then(function(model) {
              model.load('classesTeacherOf').then(function() {

                var jsonPromise = model.toJSON();
                var jsonOmitPivotPromise = model.toJSON({ omitPivot: true });

                BluebirdPromise.join(jsonPromise, jsonOmitPivotPromise, function(json, jsonOmitPivot) {
                  expect(json).to.eql(expectedJsonWithPivot);
                  expect(jsonOmitPivot).to.eql(expectedJsonWithoutPivot);

                  tracker.uninstall();

                  done();
                });
              });
            });
          });
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
            contextSpecificVisibleProperties: {
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
        (
          fetchElephant1LoadGroupsMemberOf(query)
            .concat(determineRoleElephant1SlouchyGauchos(query))
            .concat(determineRoleElephant1SlouchyGauchos(query)) // Necessary for the second call of .toJSON(),
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
            contextSpecificVisibleProperties: {
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
              contextSpecificVisibleProperties: {
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
        fetchElephant1LoadGroupsMemberOf(query)
          .concat(determineRoleElephant1SlouchyGauchos(query))[step - 1]();
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
            contextSpecificVisibleProperties: {
              groups: [ 'id', 'name' ]
            }
          }).then(function(result) {
            expect(result.groupsMemberOf).to.eql([{
              id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
              name: 'Slouchy gauchos'
            }]); // This array would be an array containing a serialized promise,
            // if relation arrays were not resolved as a promise of all the
            // promises in the array. QED.

            tracker.uninstall();
            done();
          });
        });
      });
    });
    it('should serialize a relation that is an empty model as null rather than as an empty object', function(done) {
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
    it('should serialize a standalone empty model as an empty object', function(done) {
      // Not sure why anyone would ever care about the result of serializing an empty object,
      // but it's good to document the behavior nonetheless.
      bookshelf.Model.extend({
        tableName: 'foo',
        roleDeterminer: function() { return 'anyone'; },
        rolesToVisibleProperties: { anyone: [ 'bar' ] }
      }).forge({}, { accessor:
        { user: { id: stubs.users.elephant1.id } }
      })
      .toJSON()
      .then(function(result) {
        expect(result).to.eql({});
        done();
      });
    });
    it('should serialize an empty model that exists in a collection that is a relation as an empty object', function(done) {
      var tracker = mockKnex.getTracker();
      tracker.install();
      tracker.on('query', function sendResult(query, step) {
        fetchElephant1LoadGroupsMemberOf(query)
          .concat(determineRoleElephant1SlouchyGauchos(query))[step - 1]();
      });

      User.forge({ username: 'elephant1' }, {
        accessor: { user: { id: stubs.users.elephant1.id } }
      })
      .fetch()
      .then(function(user) {
        user.load('groupsMemberOf').then(function() {
          var groups = user.related('groupsMemberOf'); // Need to call this because
          // .related() is what transfers model._accessor to the relation
          groups.add(User.forge({}, {
            accessor: { user: { id: stubs.users.elephant1.id } }
          }));

          user.toJSON({
            contextSpecificVisibleProperties: {
              groups: [ 'id', 'name' ]
            }
          }).then(function(result) {
            expect(result.groupsMemberOf).to.eql([
              {
                id: '0f91fab2-48b5-4396-9b75-632f99da02c2',
                name: 'Slouchy gauchos'
              },
              {}
            ]);

            tracker.uninstall();
            done();
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
  var bookshelf = require('bookshelf')(knex);
  bookshelf.plugin('registry');
  bookshelf.plugin(plugin());

  var Comment = require('../examples/rest-api/Comment.js')(bookshelf);
  var User = require('../examples/rest-api/User.js')(bookshelf);

  describe('serialize', function() {
    it('should wait for all promises in the collection to resolve', function(done) {
      bookshelf.Collection.extend({ model: Comment }).forge([
        Comment.forge({ content: 'comment1' },
          { accessor: { user: { id: stubs.users.elephant1.id } } }),
        Comment.forge({ content: 'comment2' },
          { accessor: { user: { id: stubs.users.elephant1.id } } }),
      ])
      .toJSON()
      .then(function(result) {
        expect(result).to.eql([
          { content: 'comment1' },
          { content: 'comment2' }
        ]); // This would be serialized as an array of promises if not all promises
        // in the collection were waited for. QED.
        done();
      });
    });
    it('should remove `undefined`s from a serialized collection', function(done) {
      bookshelf.Collection.extend({ model: Comment }).forge([
        Comment.forge({ id: 1, content: 'comment1' },
          { accessor: { user: { id: stubs.users.elephant1.id } } }),
        Comment.forge({ id: 2, content: 'comment2' },
          { accessor: { user: { id: stubs.users.elephant1.id } } }),
      ])
      .toJSON({
        contextDesignator: function(tableName, relationChain, id) {
          if (tableName === 'comments') {
            if (id === 1) {
              return 'foo';
            } else if (id === 2) {
              return 'bar';
            }
          }
        },
        contextSpecificVisibleProperties: {
          comments: {
            foo: [ 'id', 'content' ],
            bar: []
          }
        }
      })
      .then(function(result) {
        expect(result).to.eql([
          { id: 1, content: 'comment1' }
        ]);

        done();
      });
    });
  });
  describe('toJSON', function() {
    it('should return a promise of a serialization result', function(done) {
      var serializationResultPromise = bookshelf.Collection.extend({ model: Comment }).forge([
        User.forge({ username: 'foo' }, { accessor: { user: { id: stubs.users.elephant1.id } } })
      ]).toJSON();
      expect(serializationResultPromise).to.be.a(BluebirdPromise);
      serializationResultPromise.then(function(serializationResult) {
        serializationResultPromise.then(function(serializationResult) {
          expect(serializationResult).to.eql([{ username: 'foo' }]);
          done();
        });
      });
    });
    it('should apply options passed to `toJSON` to the models in the collection', function(done) {
      bookshelf.Collection.extend({ model: Comment }).forge([
        Comment.forge({ id: 1, content: 'comment1' },
          { accessor: { user: { id: stubs.users.elephant1.id } } })
      ])
      .toJSON({
        contextSpecificVisibleProperties: {
          comments: [ 'content' ]
        }
      })
      .then(function(result) {
        expect(result).to.eql([
          { content: 'comment1' }
        ]);

        done();
      });
    });
    it('should serialize an empty model in a standalone collection as an empty object', function(done) {
      // Not sure why anyone would care about this behavior, but good to document it.
      bookshelf.Collection.extend({ model: Comment }).forge([
        Comment.forge({}, { accessor: { user: { id: stubs.users.elephant1.id } } })
      ]).toJSON().then(function(result) {
        expect(result).to.eql([ {} ]);
        done();
      });
    });
  });
});
