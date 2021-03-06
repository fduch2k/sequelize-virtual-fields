# sequelize-virtual-fields.js

# Sequelize virtual fields magic

## What's it for?

This plugin for [Sequelize](http://sequelizejs.com/) adds some magic to VIRTUAL fields, so that they can be used the same as normal fields.

If a virtual field references attributes of an associated model, this can be defined in the model's definition and the required associations are loaded automatically by `Model#find()`.

Why is this useful? You might, for example, want to build a Drupal-style framework where every model instance has a 'name' field which which may take its value from fields in associated models.

## Current status

[![Build Status](https://secure.travis-ci.org/overlookmotel/sequelize-virtual-fields.png?branch=master)](http://travis-ci.org/overlookmotel/sequelize-virtual-fields)
[![Dependency Status](https://david-dm.org/overlookmotel/sequelize-virtual-fields.png)](https://david-dm.org/overlookmotel/sequelize-virtual-fields)

API is stable. All features and options are fairly well tested. Works with all dialects of SQL supported by Sequelize (MySQL, Postgres, SQLite).

Requires Sequelize v2.0.0-rc3 or later.

## Usage

### Loading module

To load module:

	var Sequelize = require('sequelize-virtual-fields')();
	// NB Sequelize must also be present in `node_modules`

or, a more verbose form useful if chaining multiple Sequelize plugins:

	var Sequelize = require('sequelize');
	require('sequelize-virtual-fields')(Sequelize);

### Defining virtual fields

Define the dependency of the virtual fields on other attributes or models:

	// define models
	var Person = sequelize.define('Person', { name: Sequelize.STRING });
	var Task = sequelize.define('Task', {
		name: Sequelize.STRING,
		nameWithPerson: {
			type: Sequelize.VIRTUAL,
			get: function() { return this.name + ' (' + this.Person.name + ')' }
			attributes: [ 'name' ],
			include: [ { model: Person, attributes: [ 'name' ] } ],
			order: [ ['name'], [ Person, 'name' ] ]
		}
	});
	
	// define associations
	Task.belongsTo(Person);
	Person.hasMany(Task);
	
	// activate virtual fields functionality
	sequelize.initVirtualFields();

Create some data:

	// create a person and task and associate them
	Promise.all({
		person: Person.create({ name: 'Brad Pitt' }),
		task: Task.create({ name: 'Do the washing' })
	}).then(function(r) {
		return r.task.setPerson(r.person);
	});

### Retrieving virtual fields

`find()` a task, referencing the virtual field:

	Task.find({ attributes: [ 'nameWithPerson' ] })
	.then(function(task) {
		// task.values = { nameWithPerson: 'Do the washing (Brad Pitt)' }
	});

The associated model 'Person' has been automatically fetched in order to get the name of the person.

The fields and eager-loaded associations necessary (`Person`, `Company`) are deleted from the result before returning.

### Ordering by virtual fields

You can also order by a virtual field:

	Task.findAll({
		attributes: [ 'nameWithPerson' ],
		order: [ [ 'nameWithPerson' ] ]
	});

### Notes

The behaviour of `find()` in examples above works because of the definition of `attribute`, `include` and `order` in the `Task` model's definition, as well as the getter function `get`.

### IMPORTANT NOTE

This plugin changes the normal function of `Instance#get()` and `Instance.values` in Sequelize.

Usually virtual fields are not present in `Instance#dataValues` and have to be accessed with `Instance#get()` or by `<instance>.<attribute name>`. This plugin alters that behaviour - virtual fields' values are added to `dataValues` before results are returned from `Model#find()`, and then calling `get()` basically just retrieves `dataValues`.

The purpose is for virtual fields to look and behave exactly like normal fields for getting purposes (setting is another matter!)

## Tests

Use `npm test` to run the tests.
Requires a database called 'sequelize_test' and a db user 'sequelize_test' with no password.

## Changelog

See changelog.md

## Known issues

* Does not work with use of `association` in place of `model` in `include` or `order` e.g. `someModel.findAll({ include: [ {association: someAssociation } ] })` - throws error if encountered
* No support for `Sequelize.col()` in order clauses
* Crashes when using '.getXXX()' accessors to get many-to-many association if virtual fields defined in through model
* Fails to remove all virtually included models (broken by recent changes to Sequelize, am working on a fix)

If you discover a bug, please raise an issue on Github. https://github.com/overlookmotel/sequelize-virtual-fields/issues
