import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/product.dart';
import '../data/product_repository.dart';

class CatalogFilter {
  const CatalogFilter({this.category, this.query = '', this.inStockOnly = false});

  final String? category;
  final String query;
  final bool inStockOnly;

  CatalogFilter copyWith({String? category, String? query, bool? inStockOnly}) => CatalogFilter(
        category: category ?? this.category,
        query: query ?? this.query,
        inStockOnly: inStockOnly ?? this.inStockOnly,
      );
}

class CatalogFilterNotifier extends Notifier<CatalogFilter> {
  @override
  CatalogFilter build() => const CatalogFilter();

  void setCategory(String? category) => state = CatalogFilter(
        category: category,
        query: state.query,
        inStockOnly: state.inStockOnly,
      );

  void setQuery(String query) => state = state.copyWith(query: query);

  void toggleInStock() => state = state.copyWith(inStockOnly: !state.inStockOnly);

  void reset() => state = const CatalogFilter();
}

final catalogFilterProvider =
    NotifierProvider<CatalogFilterNotifier, CatalogFilter>(CatalogFilterNotifier.new);

final productsProvider = FutureProvider.autoDispose<List<Product>>((ref) async {
  final filter = ref.watch(catalogFilterProvider);
  final products = await ref
      .watch(productRepositoryProvider)
      .fetchProducts(category: filter.category, query: filter.query);
  return filter.inStockOnly ? products.where((p) => p.inStock).toList() : products;
});

final productProvider = FutureProvider.autoDispose.family<Product, String>(
  (ref, id) => ref.watch(productRepositoryProvider).fetchProduct(id),
);

final reviewsProvider = FutureProvider.autoDispose.family<List<Review>, String>(
  (ref, id) => ref.watch(productRepositoryProvider).fetchReviews(id),
);
