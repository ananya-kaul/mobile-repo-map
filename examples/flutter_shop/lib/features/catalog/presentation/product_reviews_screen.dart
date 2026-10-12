import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import '../application/catalog_providers.dart';

class ProductReviewsScreen extends ConsumerWidget {
  const ProductReviewsScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviews = ref.watch(reviewsProvider(productId));
    return Scaffold(
      appBar: AppBar(title: const Text('Reviews')),
      body: reviews.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (items) => ListView.separated(
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final r = items[i];
            return ListTile(
              title: Text('${'★' * r.stars}  ${r.author}'),
              subtitle: Text(r.body),
              trailing: Text(Formatters.shortDate(r.createdAt)),
            );
          },
        ),
      ),
    );
  }
}
