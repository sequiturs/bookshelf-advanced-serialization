# bookshelf-advanced-serialization
[![Build Status](https://travis-ci.org/sequiturs/bookshelf-advanced-serialization.svg?branch=master)](https://travis-ci.org/sequiturs/bookshelf-advanced-serialization) [![Coverage Status](https://coveralls.io/repos/github/sequiturs/bookshelf-advanced-serialization/badge.svg?branch=master)](https://coveralls.io/github/sequiturs/bookshelf-advanced-serialization?branch=master) [![npm version](https://img.shields.io/npm/v/bookshelf-advanced-serialization.svg?style=flat)](https://www.npmjs.com/package/bookshelf-advanced-serialization)

## Description

This module is a plugin for [Bookshelf.js](https://github.com/tgriesser/bookshelf), supporting three types of custom serialization behavior:

1. serializing according to **access permissions**,
2. serializing according to the **application context** in which serialization is performed, and
3. serializing **after loading relations** that should be on the model / collection.

Together, these features ensure that one call to `toJSON` can yield an arbitrarily complex serialization result: any combination of a model's properties (i.e. in Bookshelf terminology, attributes and relations), the properties of its relations, and so on indefinitely. In other words, this module supports **recursive serialization** (and it does so in a way that allows infinite looping / cycling to be easily prevented if that would otherwise be a danger). This means the module excels at supporting **hierarchical data models**.

You can explore the source code on [GitHub](https://github.com/sequiturs/bookshelf-advanced-serialization). This module has a **comprehensive test suite**.

## Philosophy

This module was designed to support serializing models which represent the resources of the [Sequiturs](https://sequiturs.com) REST API. It is thus well-suited to the use case of using Bookshelf to power a REST API.

One important aspect of the REST API use case is customizing the serialization result according to the access permissions of the client. It is crucial that no data be leaked to a client who should not see it. For this reason, this module exclusively implements a **whitelisting** approach to serialization, and does not support blacklisting. Only properties that have been explicitly allowed to be serialized--whitelisted--will be returned by `toJSON`. This makes leaking data more difficult. This is good.

This **strict approach to data security** is reflected in another aspect of implementation: the module assumes that when a model has no visible properties, the serialized result should not even indicate to the client that the model exists! In practice, this means that:

1. models with no visible properties are serialized to `undefined` rather than `{}`, and
2. these `undefined` values are removed from arrays.

This is useful in the following situation, for instance: suppose there is a collection that contains public items, which the client should be able to see, and private items, which the client should not be able to see. The current implementation ensures that the client will not receive any indication how many private items exist or in what order they appear in the collection. In future, this behavior could be made optional, if that is desired.

## How to use

### Overview

The serialization result returned by `toJSON` is determined by:

1. evaluating the access permissions of the recipient to determine the maximum extent of the recipient's visibility into a model,

    - This is accomplished using three parts:
        - an `accessor` value that is passed as an option to `toJSON()` or that has been set on a model instance,
        - a `roleDeterminer` method set on the model class, and
        - a `rolesToVisibleProperties` object set on the model class.

    - `accessor` represents who is accessing the model; this is the recipient of the serialization result. `roleDeterminer` is a function for determining the role of the `accessor` in relation to the model instance. When you call `toJSON`, `roleDeterminer` is invoked, with the `accessor` passed as an argument. `rolesToVisibleProperties` is an object that maps a role to a list of properties that should be visible to someone with that role.

2. optionally specifying the subset of these role-determined visible properties that should be in the serialization result given the application context in which serialization is being performed,

    - This is accomplished using two parts:
        - a `contextSpecificVisibleProperties` object provided on the `options` object passed to `toJSON`
        - an optional `contextDesignator` function also provided on the `options` object

    - `contextSpecificVisibleProperties` indexes lists of the properties of a model that should be visible in light of the application context. These lists are indexed first by models' `tableName`, which allows for easily specifying context-specific visible properties for all models of a certain type. (We use `tableName` because this is the only identifier Bookshelf provides for identifying a model's type.) If you want fine-grained control over designating context beyond simply by model type, you can provide an `contextDesignator` function, which is invoked when you call `toJSON`, and which by default is passed the model's `tableName`, `_accessedAsRelationChain`, and `id` properties as arguments. (You can override this default behavior and pass custom arguments to `contextDesignator`, by passing your own `getEvaluatorArguments` function when registering this plugin.) The designation returned by `contextDesignator` will be used to lookup the list of context-specific visible properties, inside `contextSpecificVisibleProperties[tableName]`.

3. optionally loading specified relations on the model (or on the model's relations, recursively to any depth) before serializing, if those relations are not already loaded.

    - This is accomplished using two parts:
        - an `ensureRelationsLoaded` object provided on the `options` object passed to `toJSON`
        - an optional `contextDesignator` function also provided on the `options` object. This is the same `contextDesignator` as in 2\.

    - `ensureRelationsLoaded` works analogously to `contextSpecificVisibleProperties`, except the lists contain the names of relations that it will be ensured are loaded on the model prior to serialization, rather than context-specific visible properties.

### Installation

```JavaScript
npm install bookshelf-advanced-serialization
```

then

```JavaScript
'use strict';

var advancedSerialization = require('bookshelf-advanced-serialization');

var knex = require('knex')({ ... });
var bookshelf = require('bookshelf')(knex);

bookshelf.plugin(advancedSerialization());

module.exports = bookshelf;
```

### API

See the [docs](https://sequiturs.com/developers/open-source/bookshelf-advanced-serialization/module-bookshelf-advanced-serialization.html).

You can also view a local copy of the docs:

1. Clone the repo.
2. Generate the docs by running `npm run jsdoc`.
3. Open `docs/index.html` in your browser.

### Examples

See [`examples/rest-api`](https://github.com/sequiturs/bookshelf-advanced-serialization/tree/master/examples/rest-api).

Within [`examples/rest-api/server.js`](https://github.com/sequiturs/bookshelf-advanced-serialization/blob/master/examples/rest-api/server.js), there are examples of the different ways you can use this module to control serialization behavior:

- Using access permissions but not application context
    - See route handling for `/users/:username`.
- Using access permissions and application context
    - using `contextDesignator`'s context designations with `contextSpecificVisibleProperties`
        - See route handling for `/comments/:id`.
    - using only table names, not `contextDesignator`'s context designations, with `contextSpecificVisibleProperties`
        - See route handling for `/comments/:id`, specifically the `users` table name.
    - using custom arguments in the `contextDesignator` function
        - See route handling for `/comments/:id`.
    - using the default `relationChain` argument to `contextDesignator`
        - (No example of this.)
- After ensuring certain relations have been loaded
    - using `contextDesignator`'s context designations with `ensureRelationsLoaded`
        - See route handling for `/comments/:id`.
    - using only table names, not `contextDesignator`'s context designations, with `ensureRelationsLoaded`
        - See route handling for `/users/:username`.
    - using custom arguments in the `contextDesignator` function
        - See route handling for `/comments/:id`.
    - using the default `relationChain` argument to `contextDesignator`
        - (No example of this.)

## License

See [`LICENSE`](https://github.com/sequiturs/bookshelf-advanced-serialization/blob/master/LICENSE).
