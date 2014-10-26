// --------------------
// Sequelize virtual fields
// Sequelize#initVirtualFields() method
// --------------------

// modules
var _ = require('lodash'),
	toposort = require('toposort-extended');

// imports
var utils = require('./utils');

// exports
module.exports = function(Sequelize) {
	return function(options) {
		var sequelize = this;
		
		options = options || {};
		
		// parse virtual fields for all models
		var models = sequelize.models;
		_.forIn(models, function(model, modelName) {
			_.forEach(model.attributes, function(field, fieldName) {
				if (field.type == Sequelize.VIRTUAL) parseField(field, fieldName, model);
			});
		});
		
		// inherit attributes, include and order where virtual fields refer to other virtual fields
		inheritInclude();
		inheritOrder();
		
		// return sequelize (for chaining)
		return sequelize;
		
		// ----------
		// functions
		
		// parse a virtual field to check attributes, include and order are valid
		function parseField(field, fieldName, model) {
			// parse & check attributes and include
			parseInclude(field, fieldName, model.name, model);
			
			// parse & check order
			parseOrder(field, fieldName, model);
		}
		
		// parses attributes and include
		// ensuring attributes & includes are valid, formatting includes in {model: model} format
		// and checking associations between models are valid
		function parseInclude(field, fieldName, modelName, parent) {
			// check all attributes are strings and valid fields
			if (!field.attributes) {
				field.attributes = [];
			} else {
				if (!Array.isArray(field.attributes)) field.attributes = [field.attributes];

				_.forEach(field.attributes, function(attribute) {
					if (!_.isString(attribute)) throw new Sequelize.SequelizeVirtualFieldsError("Attribute of virtual field '" + modelName + "'.'" + fieldName + "' is not a string");
					
					if (!parent.attributes[attribute]) throw new Sequelize.SequelizeVirtualFieldsError("Attribute of virtual field '" + modelName + "'.'" + fieldName + "' refers to a nonexistent field '" + parent.name + "'.'" + attribute + "'");
				});
			}
			
			// format includes as {model: model, as: as} and convert strings to models
			if (field.include) {
				if (!Array.isArray(field.include)) field.include = [field.include];

				_.forEach(field.include, function(include, index) {
					include = parseClause(field.include, index, 'Include', modelName, fieldName, parent);
					
					parseInclude(include, fieldName, modelName, include.model);
				});
			}
		}
		
		// parses order attribute converting all models to {model: model} format, adding ASC/DESC order
		// and checking attributes are valid and model associations are valid
		function parseOrder(field, fieldName, model) {
			if (!field.order) return;
			
			if (!Array.isArray(field.order)) field.order = [order];
			
			_.forEach(field.order, function(order, index) {
				// if just a string, leave alone - is raw query
				if (_.isString(order)) return;
				
				// if an object (e.g. {raw: ...}), add 'ASC' sort order
				if (!Array.isArray(order)) order = field.order[index] = [order, 'ASC'];
				
				// add 'ASC' sort order if no sort order defined
				if (order.length == 0) {
					throw new Sequelize.SequelizeVirtualFieldsError("Invalid virtual field order in '" + model.name + "'.'" + fieldName + "'");
				} else if (order.length == 1) {
					order[1] = 'ASC';
				} else {
					// ensure direction is ASC or DESC
					if (['ASC', 'DESC'].indexOf(order[order.length - 1].toUpperCase()) == -1) {
						order.push('ASC');
					} else {
						order[order.length - 1] = order[order.length - 1].toUpperCase();
					}
				}
				
				// make preceeding models into {model: model} form
				var parent = model;
				for (var i = 0; i < order.length - 2; i++) {
					parseClause(order, i, 'Order', model.name, fieldName, parent);
					parent = order[i].model;
				}
				
				// check attribute is valid
				var attribute = order[order.length - 2];
				if (_.isString(attribute) && !parent.attributes[attribute]) throw new Sequelize.SequelizeVirtualFieldsError("Order of virtual field '" + model.name + "'.'" + fieldName + "' refers to a nonexistent field '" + parent.name + "'.'" + attribute + "'");
			});
		}
		
		// formats a clause into {model: model} format
		// and checks association to parent is valid
		function parseClause(array, index, clauseType, modelName, fieldName, parent) {
			var item = array[index];
			
			if (_.isString(item) || item instanceof Sequelize.Model) {
				item = array[index] = {model: item};
			} else if (!item.model) {
				throw new Sequelize.SequelizeVirtualFieldsError(clauseType + " of virtual field '" + modelName + "'.'" + fieldName + "' is invalid");
			}
			
			if (_.isString(item.model)) {
				var model = sequelize.models[item.model];
				if (!model) throw new Sequelize.SequelizeVirtualFieldsError(clauseType + " of virtual field '" + modelName + "'.'" + fieldName + "' points to unknown model '" + item.model + "'");
				item.model = model;
			} else if (!(item.model instanceof Sequelize.Model)) {
				throw new Sequelize.SequelizeVirtualFieldsError(clauseType + " of virtual field '" + modelName + "'.'" + fieldName + "' is invalid");
			}
			
			if (item.as !== undefined && !_.isString(item.as)) throw new Sequelize.SequelizeVirtualFieldsError(clauseType + " of virtual field '" + modelName + "'.'" + fieldName + "' has invalid as clause '" + item.as + "'");
			
			// check if is valid association from parent
			if (!parent.getAssociation(item.model, item.as)) throw new Sequelize.SequelizeVirtualFieldsError(clauseType + " of virtual field '" + modelName + "'.'" + fieldName + "' includes invalid association from '" + parent.name + "' to '" + item.model.name + (item.as ? ' (' + item.as + ')' : '') + "'");
			
			return item;
		}
		
		function inheritInclude() {
			// find virtual fields that refer to other virtual fields
			var dependencies = [];
			_.forIn(models, function(model, modelName) {
				_.forEach(model.attributes, function(field, fieldName) {
					if (field.type != Sequelize.VIRTUAL) return;
					
					(function findVirtual(field, thisModel) {
						_.forEach(field.attributes, function(thisFieldName) {
							if (thisModel.attributes[thisFieldName].type == Sequelize.VIRTUAL) {
								dependencies.push([
									{model: modelName, field: fieldName},
									{model: thisModel.name, field: thisFieldName}
								]);
							}
						});
						
						_.forEach(field.include, function(include) {
							findVirtual(include, include.model);
						});
					})(field, model);
				});
			});
			
			// order fields in order of dependency + check for circular dependency
			try {
				dependencies = toposort.dependents(dependencies).reverse();
			} catch(err) {
				if (!(err instanceof toposort.Error)) throw err;
				throw new Sequelize.SequelizeVirtualFieldsError("Circular dependency in virtual fields at '" + err.edge.model + "'.'" + err.edge.field + "'");
			}
			
			// extend definition of virtual fields to include dependent attributes and includes
			_.forEach(dependencies, function(dependent) {
				var model = models[dependent.model],
					field = model.attributes[dependent.field];
				
				(function mergeVirtual(field, model) {
					for (var i = 0; i < field.attributes.length; i++) {
						var referencedField = model.attributes[field.attributes[i]];
						if (referencedField.type == Sequelize.VIRTUAL) {
							field.attributes.splice(i, 1);
							i--;
							
							mergeClauses(field, referencedField);
						}
					}
					
					_.forEach(field.include, function(include) {
						mergeVirtual(include, include.model);
					});
				})(field, model);
			});
		}
		
		function inheritOrder() {
			// extend order clauses where refer to virtual fields
			var dependencies = [];
			_.forIn(models, function(model, modelName) {
				_.forEach(model.attributes, function(field, fieldName) {
					if (field.type != Sequelize.VIRTUAL || !field.order) return;
					
					_.forEach(field.order, function(order) {
						var orderModel = (order.length > 2) ? order[order.length - 3].model : model,
							orderFieldName = order[order.length - 2];
						
						if (orderModel.attributes[orderFieldName].type == Sequelize.VIRTUAL) {
							dependencies.push([
								{model: modelName, field: fieldName},
								{model: orderModel.name, field: orderFieldName}
							]);
						}
					});
				});
			});
			
			// order fields in order of dependency + check for circular dependency
			try {
				dependencies = toposort.dependents(dependencies).reverse();
			} catch(err) {
				if (!(err instanceof toposort.Error)) throw err;
				throw new Sequelize.SequelizeVirtualFieldsError("Circular dependency in virtual fields at '" + err.edge.model + "'.'" + err.edge.field + "' in order clause");
			}
			
			// replace order clauses referring to virtual fields with real fields
			_.forEach(dependencies, function(dependent) {
				var model = models[dependent.model],
					fieldName = dependent.field,
					orders = model.attributes[fieldName].order;
				
				for (var i = 0; i < orders.length; i++) {
					var order = orders[i],
						fromModel = (order.length > 2) ? order[order.length - 3].model : model,
						fromFieldName = order[order.length - 2],
						fromField = fromModel.attributes[fromFieldName];
					
					if (fromField.type != Sequelize.VIRTUAL) continue;
					
					var fromOrders = fromField.order;
					if (!fromOrders || fromOrders.length == 0) throw new Sequelize.SequelizeVirtualFieldsError("Order clause in virtual field '" + model.name + "'.'" + fieldName + "' refers to virtual field '" + fromModel.name + "'.'" + fromFieldName + "' which has no order clause defined");
					
					// replace virtual field order clause with referenced virtual field's own order clauses
					orders.splice(i, 1);
					
					var orderClauseBase = order.slice(0, -2);
					fromOrders.forEach(function(fromOrder) {
						orders.splice(i, 0, orderClauseBase.concat(fromOrder));
						i++;
					});
					
					i--;
				}
			});
		}
		
		function mergeClauses(item, fromItem) {
			// merge attributes
			if (item.attributes) {
				if (!fromItem.attributes) {
					delete item.attributes;
				} else {
					item.attributes = _.union(item.attributes, fromItem.attributes);
				}
			}
			
			// merge includes
			if (fromItem.include) {
				if (!item.include) {
					item.include = fromItem.include;
				} else {
					_.forEach(fromItem.include, function(fromInclude) {
						var toInclude = _.find(item.include, function(toInclude) {
							return toInclude.model == fromInclude.model && toInclude.as == fromInclude.as;
						});

						if (toInclude) {
							mergeClauses(toInclude, fromInclude);
						} else {
							item.include.push(fromInclude);
						}
					});
				}
			}
		}
	};
}