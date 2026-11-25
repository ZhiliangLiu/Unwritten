const MESSAGE = 'style 只能设置 -- 开头的 CSS 自定义属性，视觉值写在 CSS Module 里';

function propertyKey(property) {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  if (property.key.type === 'Identifier') return property.key.name;
  return null;
}

export default {
  meta: { name: 'unwritten' },
  rules: {
    'style-custom-properties-only': {
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return;
            const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : null;
            if (!expression || expression.type !== 'ObjectExpression') {
              context.report({ node, message: MESSAGE });
              return;
            }
            for (const property of expression.properties) {
              const key = propertyKey(property);
              if (key === null || !key.startsWith('--')) context.report({ node: property, message: MESSAGE });
            }
          },
        };
      },
    },
  },
};
