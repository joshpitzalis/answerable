// Copyright (c) Meta Platforms, Inc. and affiliates.

"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
	HStack,
	Layout,
	LayoutContent,
	LayoutHeader,
	StackItem,
	VStack,
} from "@astryxdesign/core/Layout";
import type {
	FieldDefinition,
	InferData,
	PowerSearchFilter,
} from "@astryxdesign/core/PowerSearch";
import {
	PowerSearch,
	usePowerSearchConfig,
} from "@astryxdesign/core/PowerSearch";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Table } from "@astryxdesign/core/Table";
import { Heading } from "@astryxdesign/core/Text";
import {
	ArrowDownTrayIcon,
	FunnelIcon,
	PlusIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";

interface TablePageProps<
	Fields extends ReadonlyArray<FieldDefinition>,
	Row extends InferData<Fields> & Record<string, unknown>,
> {
	/** Page heading, also the PowerSearch config name. */
	readonly title: string;
	readonly data: Row[];
	readonly columns: TableColumn<Row>[];
	/** Searchable/filterable fields. Declare `as const` so keys infer. */
	readonly fieldDefs: Fields;
	readonly idKey: keyof Row & string;
	readonly searchPlaceholder?: string;
}

export function TableComponent<
	const Fields extends ReadonlyArray<FieldDefinition>,
	Row extends InferData<Fields> & Record<string, unknown>,
>({
	title,
	data,
	columns,
	fieldDefs,
	idKey,
	searchPlaceholder = "Search...",
}: TablePageProps<Fields, Row>) {
	const [filters, setFilters] = useState<PowerSearchFilter[]>([]);
	const { config, applyFilters } = usePowerSearchConfig(fieldDefs, title);

	const filtered = useMemo(
		() => applyFilters(filters, data),
		[filters, applyFilters, data],
	);

	return (
		<Layout
			// ponytail: "auto" to scroll with the page (AppShell is height="auto"
			// and Footer sits below it). Switch to "fill" if the shell goes "fill".
			height="auto"
			header={
				<LayoutHeader hasDivider>
					<HStack gap={2} vAlign="center" paddingInline={6} paddingBlock={3}>
						<StackItem size="fill">
							<Heading level={1}>{title}</Heading>
						</StackItem>
						<IconButton
							label="Filter"
							icon={<Icon icon={FunnelIcon} size="sm" />}
							variant="ghost"
						/>
						<IconButton
							label="Download"
							icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
							variant="ghost"
						/>
						<Button label="Add" icon={<Icon icon={PlusIcon} size="sm" />} />
					</HStack>
				</LayoutHeader>
			}
			content={
				<LayoutContent padding={6}>
					<VStack gap={5}>
						<PowerSearch
							config={config}
							filters={filters}
							onChange={(newFilters) => {
								setFilters([...newFilters]);
							}}
							placeholder={searchPlaceholder}
							resultCount={filtered.length}
						/>
						<Table<Row>
							data={filtered}
							columns={columns}
							idKey={idKey}
							density="balanced"
							dividers="rows"
							hasHover
						/>
					</VStack>
				</LayoutContent>
			}
		/>
	);
}
