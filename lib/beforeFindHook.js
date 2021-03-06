// --------------------
// Sequelize virtual fields
// beforeFind hook function
// --------------------

// modules
var _ = require('lodash');

// imports
var shared = require('./shared'),
	mergeClauses = shared.mergeClauses,
	mergeOrders = shared.mergeOrders;

// exports
module.exports = function(options) {
	var model = this,
		sequelize = model.sequelize,
		Sequelize = sequelize.Sequelize;
	
	if (!sequelize.options.virtualFields.active) return;
	
	replaceVirtualFields(options, model);
	replaceVirtualOrders(options, model);
	
	// ----------
	// functions
	
	function replaceVirtualFields(options, model) {
		if (options.attributes) {
			for (var i = 0; i < options.attributes.length; i++) { // not using _.forEach as array is altered during looping
				var fieldName = options.attributes[i],
					field = model.attributes[fieldName];
				
				if (!field) throw new Sequelize.SequelizeVirtualFieldsError("Field '" + model.name + '.' + fieldName + "' referenced in a virtual field does not exist");
				
				if (field.type != Sequelize.VIRTUAL) continue;
				
				// field is virtual - add attributes & includes from virtualField
				addVirtualFieldOptions(options, field, fieldName);
				
				// delete virtual attribute
				options.attributes.splice(i, 1);
				i--;
			}
		} else {
			// no attributes specified - all attributes of model will load so check all virtualFields
			_.forIn(model.attributes, function(field, fieldName) {
				// add attributes & includes from virtual field
				if (field.type == Sequelize.VIRTUAL) addVirtualFieldOptions(options, field, fieldName);
			});
		}
		
		// repeat process for all includes recursively
		var includes = options.include;
		if (includes) {
			_.forEach(includes, function(include, index) {
				// if include given as model with no attributes/include, convert to {model: model} notation
				if (include instanceof Sequelize.Model) include = includes[index] = {model: include};
				
				// recurse through this include
				replaceVirtualFields(include, include.model);
			});
		}
	}
	
	function addVirtualFieldOptions(options, field, fieldName) {
		// merge attributes + includes from virtual field
		mergeClauses(options, field, true);
		
		// record in options._virtual
		options._virtual.get.push(fieldName);
	}
	
	function replaceVirtualOrders(options, model) {
		var Sequelize = model.sequelize.Sequelize;
		
		var orders = options.order;
		if (!options.order) return;
		if (!Array.isArray(orders)) orders = options.order = [orders];
		
		// parse order clauses, adding 'ASC' if none provided
		_.forEach(orders, function(order, index) {
			// if just a string, leave alone - is raw query
			if (_.isString(order)) return;
			
			// if an object (e.g. {raw: ...}), add 'ASC' sort order
			if (!Array.isArray(order)) {
				orders[index] = [order, 'ASC'];
				return;
			}
			
			// add 'ASC' sort order if no sort order defined
			if (order.length == 0) throw new Sequelize.SequelizeVirtualFieldsError('Invalid order clause');
			if (order.length == 1 || !_.isString(order[order.length - 2])) {
				order.push('ASC');
			} else {
				order[order.length - 1] = order[order.length - 1].toUpperCase();
			}
			
			// ensure all models are in form of {model: model}
			for (var i = 0; i < order.length - 2; i++) {
				if (order[i] instanceof Sequelize.Model) order[i] = {model: order[i]};
			}
		});
		
		// replace virtual fields in orders by their referenced fields
		mergeOrders(orders, model);
	}
};
